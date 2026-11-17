// Linking a wallet (architecture.md sections 3.6 and 5.3.4). A link is stored only after five checks:
// parse the URI, read the info event, call get_info, apply the permission policy, create and look up a 1-sat test
// invoice. The URI is then encrypted; it is never returned, logged or sent to a browser again.
import { core } from '@selly/db';
import { and, eq, ne } from '@selly/db/orm';
import { checkPermissions, NwcConnection, NwcError, parseNwcUri } from '@selly/nwc';
import type { Config } from '../../config';
import type { Context, Database, Logger } from '../../context';
import { AppError } from '../../errors';
import { type Keyring, walletAad } from '../../secrets';
import { iso } from '../../util';
import { audit } from '../events/outbox';

const { walletConnections: wc } = core;
export type WalletRow = typeof wc.$inferSelect;
export type WalletDeps = Pick<Context, 'config' | 'db' | 'now' | 'keyring' | 'log'>;

export const nwcOptions = (config: Config) => ({
  network: config.LIGHTNING_NETWORK,
  timeouts: {
    makeInvoiceMs: config.NWC_MAKE_INVOICE_TIMEOUT_MS,
    lookupInvoiceMs: config.NWC_LOOKUP_TIMEOUT_MS,
    getInfoMs: config.NWC_GET_INFO_TIMEOUT_MS,
  },
});

export function requireKeyring(k: Keyring | null): Keyring {
  if (!k) {
    throw new Error(
      'No encryption key: set SECRETS_KEK_V1 to 32 random bytes in base64, for example the output of ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return k;
}

/** NwcError from the wallet layer to the API's stable codes and French messages (architecture.md section 5.3.4). */
function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof NwcError) {
    switch (err.code) {
      case 'NWC_URI_INVALID':
        return new AppError('NWC_URI_INVALID', err.message);
      case 'NWC_TIMEOUT':
        return new AppError('NWC_TIMEOUT', 'Votre portefeuille ne répond pas. Est-il en ligne ?');
      case 'NWC_WALLET_ERROR':
        return new AppError(
          'NWC_WALLET_ERROR',
          `Le portefeuille a refusé la demande (${err.walletCode ?? 'erreur'}).`,
        );
      case 'NWC_BAD_INVOICE':
        return new AppError(
          'NWC_WALLET_ERROR',
          'Le portefeuille a renvoyé une facture incorrecte.',
        );
      default:
        return new AppError('NWC_WALLET_ERROR', err.message);
    }
  }
  return new AppError('NWC_TIMEOUT', 'Votre portefeuille ne répond pas. Est-il en ligne ?');
}

export interface LinkInput {
  owner: 'vendor' | 'platform';
  vendorId?: string;
  uri: string;
  actor: string;
}

export async function linkWallet(deps: WalletDeps, input: LinkInput) {
  const keyring = requireKeyring(deps.keyring);
  if ((input.owner === 'vendor') !== !!input.vendorId)
    throw new Error('vendorId is required for a vendor wallet, and only then');

  let parsed: ReturnType<typeof parseNwcUri>;
  try {
    parsed = parseNwcUri(input.uri, { allowInsecureRelays: deps.config.NWC_ALLOW_INSECURE_RELAYS });
  } catch (err) {
    throw toAppError(err);
  }

  const conn = new NwcConnection(parsed, nwcOptions(deps.config));
  let checked: {
    methods: string[];
    notifications: boolean;
    encryption: string;
    balanceMsat: number | null;
  };
  try {
    const info = await conn.info().catch((err) => {
      if (err instanceof NwcError && err.code === 'NWC_WALLET_ERROR') {
        throw new AppError('NWC_METHODS_MISSING', 'Cette connexion doit autoriser get_info.', {
          errors: [{ method: 'get_info' }],
        });
      }
      throw err;
    });

    const policy = checkPermissions(info.methods);
    if (!policy.ok) {
      throw policy.code === 'NWC_PERMISSIONS_TOO_BROAD'
        ? new AppError(
            'NWC_PERMISSIONS_TOO_BROAD',
            'Cette connexion peut dépenser vos fonds. Créez une connexion en réception seule.',
            {
              errors: policy.methods.map((method) => ({ method })),
            },
          )
        : new AppError(
            'NWC_METHODS_MISSING',
            'Ce portefeuille ne permet pas de créer ou de vérifier des factures.',
            {
              errors: policy.methods.map((method) => ({ method })),
            },
          );
    }

    // The test invoice proves make_invoice and lookup_invoice work end to end. It is never paid.
    const test = await conn.makeInvoice({
      amountMsat: 1000,
      description: 'Selly : test de connexion',
      expirySeconds: 60,
    });
    const found = await conn.lookupInvoice(test.paymentHash);
    if (!found.found)
      throw new AppError('NWC_WALLET_ERROR', 'Le portefeuille ne retrouve pas la facture de test.');

    const balanceMsat = policy.hasBalance ? await conn.balanceMsat().catch(() => null) : null;
    checked = {
      methods: info.methods,
      notifications: info.notifications.includes('payment_received'),
      encryption: info.encryptions.includes('nip44_v2') ? 'nip44_v2' : 'nip04',
      balanceMsat,
    };
  } catch (err) {
    throw toAppError(err);
  } finally {
    conn.close();
  }

  const now = deps.now();
  const { ciphertext, keyVersion } = keyring.encrypt(
    input.uri.trim(),
    walletAad({ owner: input.owner, vendorId: input.vendorId ?? null }),
  );

  const row = await deps.db.transaction(async (tx) => {
    const live = await tx
      .update(wc)
      .set({ status: 'revoked', revokedAt: now, uriCiphertext: null })
      .where(and(ownerScope(input), ne(wc.status, 'revoked')))
      .returning({ id: wc.id });
    const [created] = await tx
      .insert(wc)
      .values({
        owner: input.owner,
        vendorId: input.vendorId ?? null,
        kind: 'nwc',
        uriCiphertext: ciphertext,
        keyVersion,
        walletPubkey: parsed.walletPubkey,
        clientPubkey: parsed.clientPubkey,
        relays: parsed.relays,
        methods: checked.methods,
        notifications: checked.notifications,
        encryption: checked.encryption,
        lud16: parsed.lud16,
        status: 'active',
        lastOkAt: now,
      })
      .returning();
    await audit(tx, {
      actor: input.actor,
      action: live.length > 0 ? 'wallet.replaced' : 'wallet.linked',
      target: input.vendorId ?? 'platform',
      details: {
        wallet_pubkey: parsed.walletPubkey,
        relays: parsed.relays,
        methods: checked.methods,
      },
    });
    return created as WalletRow;
  });

  deps.log.info(
    { walletConnectionId: row.id, owner: row.owner, vendorId: row.vendorId },
    'wallet linked',
  );
  return walletView(row, checked.balanceMsat);
}

function ownerScope(input: { owner: 'vendor' | 'platform'; vendorId?: string | undefined }) {
  return input.owner === 'platform'
    ? eq(wc.owner, 'platform')
    : and(eq(wc.owner, 'vendor'), eq(wc.vendorId, input.vendorId as string));
}

export async function liveWallet(
  db: Database,
  scope: { owner: 'vendor' | 'platform'; vendorId?: string },
) {
  const [row] = await db
    .select()
    .from(wc)
    .where(and(ownerScope(scope), ne(wc.status, 'revoked')));
  return row ?? null;
}

export async function unlinkWallet(
  deps: WalletDeps,
  scope: { owner: 'vendor' | 'platform'; vendorId?: string; actor: string },
) {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const rows = await tx
      .update(wc)
      .set({ status: 'revoked', revokedAt: now, uriCiphertext: null })
      .where(and(ownerScope(scope), ne(wc.status, 'revoked')))
      .returning({ id: wc.id });
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'No wallet is linked.');
    await audit(tx, {
      actor: scope.actor,
      action: 'wallet.unlinked',
      target: scope.vendorId ?? 'platform',
    });
    return true;
  });
}

/** What the dashboard may see. Never the URI. */
export function walletView(row: WalletRow, balanceMsat: number | null = null) {
  return {
    kind: row.kind,
    status: row.status,
    methods: row.methods,
    notifications: row.notifications,
    receive_only: true,
    relays: row.relays,
    lud16: row.lud16,
    balance_sat: balanceMsat === null ? null : Math.floor(balanceMsat / 1000),
    checked_at: iso(row.lastOkAt ?? row.createdAt),
    last_error: row.lastError,
  };
}

export type { Logger };
