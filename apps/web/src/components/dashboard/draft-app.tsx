'use client';

// The vendor dashboard draft (vendor-dashboard-2 on Replit), ported 1:1 from its build: same markup, texts,
// demo data and behaviour. The next commits apply the design system and connect it to core.

import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import './dashboard.css';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bitcoin,
  Check,
  CircleCheck,
  CircleHelp,
  Clock,
  Ellipsis,
  Hand,
  Headset,
  type IconComponent,
  ImagePlus,
  LayoutDashboard,
  Link2,
  MessageCircle,
  Package,
  PackageCheck,
  Plus,
  Search,
  Send,
  Settings2,
  ShoppingBag,
  Sparkles,
  Wallet,
  X,
  Zap,
} from './icons';

type Page =
  | 'Accueil'
  | 'Commandes'
  | 'Messages'
  | 'Catalogue'
  | 'Brouillons'
  | 'Portefeuille'
  | 'Abonnement';

interface NavItem {
  name: Page;
  icon: IconComponent;
  count?: number;
}

const NAV: NavItem[] = [
  { name: 'Accueil', icon: LayoutDashboard },
  { name: 'Commandes', icon: ShoppingBag, count: 3 },
  { name: 'Messages', icon: MessageCircle, count: 2 },
  { name: 'Catalogue', icon: Package },
  { name: 'Brouillons', icon: ImagePlus, count: 2 },
  { name: 'Portefeuille', icon: Wallet },
  { name: 'Abonnement', icon: Zap },
];

interface Order {
  id: string;
  customer: string;
  phone: string;
  product: string;
  date: string;
  amount: number;
  status: 'À confirmer' | 'Payée' | 'En préparation' | 'Terminée';
  payment: 'En attente' | 'Payée';
}

const ORDERS: Order[] = [
  {
    id: 'SL-2841',
    customer: 'Aminata Fall',
    phone: 'Dakar · 10:42',
    product: 'Sac Niani · cuir cognac',
    date: 'Aujourd’hui, 10:42',
    amount: 28500,
    status: 'À confirmer',
    payment: 'En attente',
  },
  {
    id: 'SL-2840',
    customer: 'Moussa Diop',
    phone: 'Médina · 09:18',
    product: 'Sandales Téranga · 42',
    date: 'Aujourd’hui, 09:18',
    amount: 18500,
    status: 'Payée',
    payment: 'Payée',
  },
  {
    id: 'SL-2838',
    customer: 'Fatou Ndiaye',
    phone: 'Almadies · hier',
    product: 'Ensemble Saly · M',
    date: 'Hier, 17:36',
    amount: 32000,
    status: 'En préparation',
    payment: 'Payée',
  },
  {
    id: 'SL-2836',
    customer: 'Ibrahima Sarr',
    phone: 'Parcelles · hier',
    product: 'Pochette Baobab',
    date: 'Hier, 15:02',
    amount: 12500,
    status: 'Terminée',
    payment: 'Payée',
  },
];

interface Product {
  name: string;
  category: string;
  price: number;
  available: number;
  reserved: number;
  tone: '' | 'terracotta' | 'blue';
}

const PRODUCTS: Product[] = [
  {
    name: 'Sac Niani',
    category: 'Maroquinerie',
    price: 28500,
    available: 8,
    reserved: 2,
    tone: 'terracotta',
  },
  {
    name: 'Sandales Téranga',
    category: 'Chaussures',
    price: 18500,
    available: 12,
    reserved: 3,
    tone: '',
  },
  {
    name: 'Ensemble Saly',
    category: 'Prêt-à-porter',
    price: 32000,
    available: 4,
    reserved: 1,
    tone: 'blue',
  },
  {
    name: 'Pochette Baobab',
    category: 'Accessoires',
    price: 12500,
    available: 7,
    reserved: 0,
    tone: 'terracotta',
  },
  {
    name: 'Foulard Thiès',
    category: 'Accessoires',
    price: 9000,
    available: 15,
    reserved: 0,
    tone: '',
  },
];

interface Draft {
  id: number;
  name: string;
  detail: string;
  price: number;
  stock: number;
  category: string;
}

const DRAFTS: Draft[] = [
  {
    id: 1,
    name: 'Baskets en cuir écru',
    detail: 'Photo ajoutée aujourd’hui · 2 variantes détectées',
    price: 24000,
    stock: 5,
    category: 'Chaussures',
  },
  {
    id: 2,
    name: 'Sac bandoulière tissé',
    detail: 'Photo ajoutée hier · description à vérifier',
    price: 19500,
    stock: 3,
    category: 'Maroquinerie',
  },
];

interface ChatMessage {
  from: 'client' | 'bot' | 'vous';
  text: string;
  time: string;
}

interface Chat {
  id: number;
  name: string;
  preview: string;
  time: string;
  handoff: boolean;
  unread?: boolean;
  messages: ChatMessage[];
}

const CHATS: Chat[] = [
  {
    id: 1,
    name: 'Aminata Fall',
    preview: 'Je peux récupérer demain ?',
    time: '10:42',
    handoff: true,
    unread: true,
    messages: [
      { from: 'client', text: 'Bonjour, le sac Niani est toujours disponible ?', time: '10:39' },
      {
        from: 'bot',
        text: 'Bonjour Aminata ! Oui, il en reste 8. Le sac Niani est à 28 500 FCFA.',
        time: '10:40',
      },
      { from: 'client', text: 'Je peux récupérer demain ?', time: '10:42' },
    ],
  },
  {
    id: 2,
    name: 'Moussa Diop',
    preview: 'Merci, paiement envoyé.',
    time: '09:21',
    handoff: false,
    messages: [
      { from: 'client', text: 'Les sandales existent en 42 ?', time: '09:16' },
      { from: 'bot', text: 'Oui, la pointure 42 est disponible à 18 500 FCFA.', time: '09:17' },
      { from: 'client', text: 'Merci, paiement envoyé.', time: '09:21' },
    ],
  },
  {
    id: 3,
    name: 'Khady Ba',
    preview: 'Vous livrez aux Parcelles ?',
    time: 'Hier',
    handoff: false,
    messages: [
      { from: 'client', text: 'Vous livrez aux Parcelles ?', time: 'Hier, 18:14' },
      {
        from: 'bot',
        text: 'La livraison est à convenir directement avec la boutique.',
        time: 'Hier, 18:15',
      },
    ],
  },
];

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

type ModalType = 'wallet' | 'product' | 'subscription';
type OrderAction = 'confirm' | 'ready' | 'done';
interface NewProduct {
  name: string;
  price: string;
  stock: string;
  category: string;
}

export function DraftDashboard() {
  const [page, setPage] = useState<Page>('Accueil');
  const [orders, setOrders] = useState(ORDERS);
  const [products, setProducts] = useState(PRODUCTS);
  const [drafts, setDrafts] = useState(DRAFTS);
  const [chats, setChats] = useState(CHATS);
  const [selectedChat, setSelectedChat] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Tous les statuts');
  const [chatSearch, setChatSearch] = useState('');
  const [reply, setReply] = useState('');
  const [modal, setModal] = useState<ModalType | null>(null);
  const [toast, setToast] = useState('');
  const [newProduct, setNewProduct] = useState<NewProduct>({
    name: '',
    price: '',
    stock: '',
    category: 'Accessoires',
  });
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState(2);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2800);
  };
  const go = (p: Page) => {
    setPage(p);
    setSearch('');
  };
  const currentChat = chats.find((c) => c.id === selectedChat) ?? chats[0];

  const shownOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          `${o.id} ${o.customer} ${o.product}`.toLowerCase().includes(search.toLowerCase()) &&
          (filter === 'Tous les statuts' ||
            (filter === 'Payées'
              ? o.payment === 'Payée'
              : filter === 'À confirmer'
                ? o.status === 'À confirmer'
                : o.status === 'En préparation')),
      ),
    [orders, search, filter],
  );
  const shownProducts = useMemo(
    () =>
      products.filter((p) =>
        `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [products, search],
  );
  const shownDrafts = useMemo(
    () =>
      drafts.filter((d) => `${d.name} ${d.category}`.toLowerCase().includes(search.toLowerCase())),
    [drafts, search],
  );
  const shownChats = useMemo(
    () =>
      chats.filter((c) =>
        `${c.name} ${c.preview}`.toLowerCase().includes(chatSearch.toLowerCase()),
      ),
    [chats, chatSearch],
  );

  function onOrderAction(id: string, action: OrderAction) {
    setOrders((all) =>
      all.map((o) =>
        o.id === id ? { ...o, status: action === 'confirm' ? 'En préparation' : 'Terminée' } : o,
      ),
    );
    flash(
      action === 'confirm'
        ? 'Commande acceptée en démo. Le paiement reste en attente.'
        : action === 'ready'
          ? 'Commande marquée comme terminée.'
          : 'Commande clôturée.',
    );
  }
  function updateChat(id: number, change: (c: Chat) => Chat) {
    setChats((all) => all.map((c) => (c.id === id ? change(c) : c)));
  }
  function toggleHandoff() {
    updateChat(selectedChat, (c) => ({ ...c, handoff: !c.handoff }));
    flash(
      currentChat?.handoff
        ? 'L’assistant reprend cette conversation.'
        : 'Vous avez repris la conversation. L’assistant se met en pause ici.',
    );
  }
  function sendReply() {
    if (!reply.trim() || !currentChat) return;
    const text = reply.trim();
    updateChat(currentChat.id, (c) => ({
      ...c,
      messages: [...c.messages, { from: 'vous', text, time: 'À l’instant' }],
      preview: text,
      time: 'À l’instant',
    }));
    setReply('');
    flash('Réponse ajoutée à la conversation de démonstration.');
  }
  function confirmDraft(d: Draft) {
    setProducts((all) => [
      {
        name: d.name,
        category: d.category,
        price: d.price,
        available: d.stock,
        reserved: 0,
        tone: 'blue',
      },
      ...all,
    ]);
    setDrafts((all) => all.filter((x) => x.id !== d.id));
    flash(`${d.name} ajouté au catalogue après confirmation.`);
  }
  function createProduct(e: FormEvent) {
    e.preventDefault();
    if (!newProduct.name || !newProduct.price) return;
    setProducts((all) => [
      {
        name: newProduct.name,
        category: newProduct.category,
        price: Number(newProduct.price),
        available: Number(newProduct.stock || 0),
        reserved: 0,
        tone: 'blue',
      },
      ...all,
    ]);
    setNewProduct({ name: '', price: '', stock: '', category: 'Accessoires' });
    setModal(null);
    flash('Produit ajouté au catalogue de démonstration.');
  }

  const help = (
    <button
      type="button"
      className="icon-button"
      aria-label="Aide"
      onClick={() => flash('Centre d’aide disponible prochainement.')}
    >
      <CircleHelp size={17} />
    </button>
  );
  const navButton = (item: NavItem, mobile = false) => {
    const Icon = item.icon;
    return (
      <button
        type="button"
        key={item.name}
        className={
          mobile
            ? `mobile-nav-item ${page === item.name ? 'active' : ''}`
            : `nav-item ${page === item.name ? 'active' : ''}`
        }
        onClick={() => go(item.name)}
        aria-current={page === item.name ? 'page' : undefined}
      >
        <Icon size={mobile ? 18 : 17} />
        <span>{item.name}</span>
        {!mobile && item.count !== undefined && <span className="nav-count">{item.count}</span>}
      </button>
    );
  };

  return (
    <div className="selly-shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">
            <ShoppingBag size={18} />
          </div>
          <span className="brand-name">selly</span>
        </div>
        <div className="side-caption">Votre boutique</div>
        <nav className="nav-list" aria-label="Navigation principale">
          {NAV.map((item) => navButton(item))}
        </nav>
        <div className="side-spacer" />
        <div className="store-card">
          <small>Mini-boutique</small>
          <div className="store-name">Atelier Niani</div>
          <div className="store-url">selly.shop/atelier-niani</div>
        </div>
        <button
          type="button"
          className="nav-item"
          onClick={() => flash('Les réglages du compte seront bientôt disponibles.')}
        >
          <Settings2 size={17} /> Réglages
        </button>
        <div className="profile">
          <div className="avatar">AF</div>
          <div>
            <strong>Aïssatou Fall</strong>
            <span>Dakar, Sénégal</span>
          </div>
          <button
            type="button"
            aria-label="Options du profil"
            className="icon-button"
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              borderColor: 'transparent',
              color: '#c6d2c8',
            }}
            onClick={() => flash('Profil de démonstration')}
          >
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            <span style={{ color: '#173b32', fontWeight: 700 }}>Atelier Niani</span>
            <span style={{ padding: '0 8px' }}>›</span>
            {page}
          </div>
          <div className="top-actions">
            <span className="demo-chip">Mode démo</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Notifications"
              onClick={() => {
                setNotifications(0);
                flash('Vous êtes à jour.');
              }}
            >
              <Bell size={17} />
              {notifications > 0 && <i className="notification-dot" />}
            </button>
            {help}
          </div>
        </header>
        <div className="content">
          {page === 'Accueil' && (
            <Overview
              go={go}
              orders={orders}
              products={products}
              onAction={onOrderAction}
              openWallet={() => setModal('wallet')}
              openSubscription={() => setModal('subscription')}
            />
          )}
          {page === 'Commandes' && (
            <Orders
              orders={shownOrders}
              search={search}
              setSearch={setSearch}
              filter={filter}
              setFilter={setFilter}
              onAction={onOrderAction}
            />
          )}
          {page === 'Messages' && (
            <Messages
              chats={shownChats}
              currentChat={currentChat}
              selectedChat={selectedChat}
              setSelectedChat={setSelectedChat}
              chatSearch={chatSearch}
              setChatSearch={setChatSearch}
              reply={reply}
              setReply={setReply}
              onReply={sendReply}
              onHandoff={toggleHandoff}
            />
          )}
          {page === 'Catalogue' && (
            <Catalogue
              products={shownProducts}
              search={search}
              setSearch={setSearch}
              add={() => setModal('product')}
              onStock={(name, delta) => {
                setProducts((all) =>
                  all.map((p) =>
                    p.name === name ? { ...p, available: Math.max(0, p.available + delta) } : p,
                  ),
                );
                flash('Stock disponible mis à jour en démo.');
              }}
            />
          )}
          {page === 'Brouillons' && (
            <Drafts
              drafts={shownDrafts}
              search={search}
              setSearch={setSearch}
              onConfirm={confirmDraft}
              onDiscard={(d) => {
                setDrafts((all) => all.filter((x) => x.id !== d.id));
                flash('Brouillon supprimé.');
              }}
            />
          )}
          {page === 'Portefeuille' && (
            <WalletPage connected={connected} open={() => setModal('wallet')} flash={flash} />
          )}
          {page === 'Abonnement' && (
            <Subscription open={() => setModal('subscription')} flash={flash} />
          )}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Navigation rapide">
        {NAV.slice(0, 5).map((item) => navButton(item, true))}
      </nav>
      {modal && (
        <Modal
          type={modal}
          onClose={() => setModal(null)}
          connected={connected}
          setConnected={setConnected}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          createProduct={createProduct}
          flash={flash}
        />
      )}
      {toast && (
        <div className="feedback" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Overview({
  go,
  orders,
  products,
  onAction,
  openWallet,
  openSubscription,
}: {
  go: (p: Page) => void;
  orders: Order[];
  products: Product[];
  onAction: (id: string, a: OrderAction) => void;
  openWallet: () => void;
  openSubscription: () => void;
}) {
  const recent = orders.slice(0, 3);
  return (
    <>
      <div className="welcome">
        <div>
          <div className="eyebrow">Mardi 18 novembre · Dakar</div>
          <h1>Bonjour, Aïssatou.</h1>
          <p>Votre boutique tourne bien. Voici ce qui mérite votre attention.</p>
        </div>
        <button type="button" className="button primary" onClick={() => go('Brouillons')}>
          <ImagePlus size={15} /> Ajouter depuis une photo
        </button>
      </div>
      <div className="stats">
        <Stat
          label="Commandes à traiter"
          value="3"
          note={
            <>
              <b>2 déjà payées</b> · à préparer
            </>
          }
          icon={ShoppingBag}
        />
        <Stat
          label="Ventes du mois"
          value="284 500"
          note={
            <>
              <b>+12,4 %</b> vs mois dernier · XOF
            </>
          }
          icon={ArrowUpRight}
        />
        <Stat
          label="Messages en attente"
          value="2"
          note={<>1 conversation à reprendre</>}
          icon={MessageCircle}
        />
        <Stat
          label="Produits disponibles"
          value={String(products.reduce((sum, p) => sum + p.available, 0))}
          note={<>sur {products.length} références</>}
          icon={Package}
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">À ne pas laisser passer</div>
              <div className="panel-sub">Vos commandes récentes</div>
            </div>
            <button type="button" className="text-link" onClick={() => go('Commandes')}>
              Toutes les commandes{' '}
              <ArrowRight size={13} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
            </button>
          </div>
          <div className="order-list">
            {recent.map((o) => (
              <div className="order-row" key={o.id}>
                <div>
                  <div className="order-code">{o.id}</div>
                  <div className="order-time">{o.phone}</div>
                </div>
                <div className="order-person">
                  <div className="order-customer">{o.customer}</div>
                  <div className="order-product">{o.product}</div>
                </div>
                <div className="order-state">
                  <StatusBadge
                    value={
                      o.status === 'À confirmer'
                        ? 'pending'
                        : o.status === 'En préparation'
                          ? 'ready'
                          : 'paid'
                    }
                  >
                    {o.status}
                  </StatusBadge>
                </div>
                <div className="money">
                  {fmt(o.amount)} <span style={{ fontSize: 9, color: '#89938d' }}>FCFA</span>
                  {o.status === 'À confirmer' && (
                    <button
                      type="button"
                      className="text-link"
                      style={{ display: 'block', marginLeft: 'auto' }}
                      onClick={() => onAction(o.id, 'confirm')}
                    >
                      Confirmer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">À votre attention</div>
              <div className="panel-sub">Un petit point sur la boutique</div>
            </div>
            <span className="status pending">3 choses</span>
          </div>
          <div className="activity">
            <div className="activity-item">
              <div className="activity-icon">
                <Hand size={15} />
              </div>
              <div className="activity-copy">
                <b>Aminata attend votre réponse</b>
                <br />
                Elle souhaite récupérer demain.
                <div className="activity-time">Il y a 2 min</div>
              </div>
              <button type="button" className="text-link" onClick={() => go('Messages')}>
                Voir
              </button>
            </div>
            <div className="activity-item">
              <div className="activity-icon">
                <ImagePlus size={15} />
              </div>
              <div className="activity-copy">
                <b>2 produits à vérifier</b>
                <br />
                Confirmés par vous, ils rejoignent le catalogue.
                <div className="activity-time">Brouillons photo</div>
              </div>
              <button type="button" className="text-link" onClick={() => go('Brouillons')}>
                Vérifier
              </button>
            </div>
            <div className="activity-item">
              <div className="activity-icon">
                <Zap size={15} />
              </div>
              <div className="activity-copy">
                <b>Votre formule expire le 30 nov.</b>
                <br />
                Encore 12 jours sur l’offre Essentiel.
                <div className="activity-time">Renouvellement manuel</div>
              </div>
              <button type="button" className="text-link" onClick={openSubscription}>
                Détails
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="lower-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Stock à surveiller</div>
              <div className="panel-sub">Disponibles et déjà réservés</div>
            </div>
            <button type="button" className="text-link" onClick={() => go('Catalogue')}>
              Gérer le stock{' '}
              <ArrowRight size={13} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
            </button>
          </div>
          <div className="stock-list">
            {products.slice(0, 4).map((p) => (
              <div className="stock-line" key={p.name}>
                <div>
                  <b>{p.name}</b>
                  <small>{p.category}</small>
                </div>
                <div className="stock-number">
                  {p.available} disponibles<em>{p.reserved} réservés</em>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Votre portefeuille</div>
              <div className="panel-sub">Wallet Lightning · réception uniquement</div>
            </div>
            <button type="button" className="text-link" onClick={openWallet}>
              Ouvrir
            </button>
          </div>
          <div className="wallet-box">
            <div className="wallet-tag">
              <Bitcoin size={15} /> Solde démo
            </div>
            <div className="wallet-amount">
              128 450 <span style={{ fontSize: 14 }}>sats</span>
            </div>
            <div className="wallet-sats">≈ 52 300 FCFA · estimation indicative</div>
            <div className="wallet-footer">
              <span>wallet.nwc</span>
              <span>Mis à jour il y a 4 min</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: ReactNode;
  icon: IconComponent;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        <Icon size={14} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function StatusBadge({ value, children }: { value: string; children: ReactNode }) {
  return (
    <span className={`status ${value}`}>
      {value === 'paid' || value === 'ready' ? <CircleCheck size={12} /> : <Clock size={12} />}
      {children}
    </span>
  );
}

function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title-row">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <div className="panel-sub">{description}</div>
      </div>
      {action}
    </div>
  );
}

function Orders({
  orders,
  search,
  setSearch,
  filter,
  setFilter,
  onAction,
}: {
  orders: Order[];
  search: string;
  setSearch: (s: string) => void;
  filter: string;
  setFilter: (s: string) => void;
  onAction: (id: string, a: OrderAction) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Ventes · votre boutique"
        title="Commandes"
        description="Chaque paiement client va directement dans votre portefeuille Lightning."
      />
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            aria-label="Rechercher une commande"
            className="search"
            placeholder="Chercher une commande ou un client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label="Filtrer les commandes"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option>Tous les statuts</option>
          <option>Payées</option>
          <option>À confirmer</option>
          <option>En préparation</option>
        </select>
      </div>
      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Commande</th>
                <th>Client</th>
                <th>Articles</th>
                <th>Paiement</th>
                <th>Préparation</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="table-primary">{o.id}</div>
                    <div className="table-secondary">{o.date}</div>
                  </td>
                  <td>
                    <div className="table-primary">{o.customer}</div>
                    <div className="table-secondary">{o.phone.split(' · ')[0]}</div>
                  </td>
                  <td>{o.product}</td>
                  <td>
                    <StatusBadge value={o.payment === 'Payée' ? 'paid' : 'pending'}>
                      {o.payment}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge
                      value={
                        o.status === 'À confirmer'
                          ? 'pending'
                          : o.status === 'Terminée'
                            ? 'paid'
                            : 'ready'
                      }
                    >
                      {o.status}
                    </StatusBadge>
                  </td>
                  <td className="table-primary">{fmt(o.amount)} XOF</td>
                  <td>
                    <div className="table-actions">
                      {o.status === 'À confirmer' ? (
                        <button
                          type="button"
                          className="button small olive"
                          onClick={() => onAction(o.id, 'confirm')}
                        >
                          Confirmer
                        </button>
                      ) : o.status === 'En préparation' ? (
                        <button
                          type="button"
                          className="button small"
                          onClick={() => onAction(o.id, 'ready')}
                        >
                          <PackageCheck size={13} /> Terminée
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button small ghost"
                          onClick={() => onAction(o.id, 'done')}
                          aria-label={`Détails de ${o.id}`}
                        >
                          <Ellipsis size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && (
            <Empty
              icon={ShoppingBag}
              title="Aucune commande trouvée"
              text="Essayez un autre mot-clé ou statut."
            />
          )}
        </div>
      </div>
    </>
  );
}

function Messages({
  chats,
  currentChat,
  selectedChat,
  setSelectedChat,
  chatSearch,
  setChatSearch,
  reply,
  setReply,
  onReply,
  onHandoff,
}: {
  chats: Chat[];
  currentChat: Chat | undefined;
  selectedChat: number;
  setSelectedChat: (id: number) => void;
  chatSearch: string;
  setChatSearch: (s: string) => void;
  reply: string;
  setReply: (s: string) => void;
  onReply: () => void;
  onHandoff: () => void;
}) {
  const initials = (name: string) =>
    name
      .split(' ')
      .map((w) => w[0])
      .join('');
  return (
    <>
      <PageTitle
        eyebrow="Ventes · conversations"
        title="Messages"
        description="L’assistant répond sur votre boutique en ligne. Reprenez la main quand vous le souhaitez."
      />
      <div className="panel conversation-layout">
        <div className="conversation-list">
          <div className="conversation-search">
            <label className="search-wrap">
              <Search size={14} />
              <input
                className="search"
                aria-label="Chercher une conversation"
                placeholder="Chercher un client…"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
              />
            </label>
          </div>
          {chats.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`conversation ${selectedChat === c.id ? 'active' : ''}`}
              onClick={() => setSelectedChat(c.id)}
            >
              <div className="avatar">{initials(c.name)}</div>
              <div className="conversation-name">
                <strong>{c.name}</strong>
                <p>{c.preview}</p>
              </div>
              <div style={{ fontSize: 9, color: '#8b968e' }}>
                {c.time}
                {c.unread && (
                  <div
                    className="nav-count"
                    style={{
                      marginTop: 6,
                      marginLeft: 'auto',
                      minWidth: 8,
                      width: 8,
                      height: 8,
                      padding: 0,
                    }}
                  />
                )}
              </div>
            </button>
          ))}
          {chats.length === 0 && (
            <Empty
              icon={MessageCircle}
              title="Aucun message"
              text="Les conversations de votre boutique apparaîtront ici."
            />
          )}
        </div>
        <div className="chat-pane">
          {currentChat ? (
            <>
              <div className="chat-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar">{initials(currentChat.name)}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{currentChat.name}</div>
                    <div style={{ fontSize: 10, color: '#839087', marginTop: 3 }}>
                      Visiteur de votre boutique
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`button small ${currentChat.handoff ? 'olive' : ''}`}
                  onClick={onHandoff}
                >
                  {currentChat.handoff ? (
                    <>
                      <Headset size={13} /> Vous avez la main
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> L’assistant répond
                    </>
                  )}
                </button>
              </div>
              <div className="chat-thread">
                {currentChat.messages.map((m, i) => (
                  <div className={`bubble ${m.from === 'vous' ? 'me' : ''}`} key={`${i}-${m.time}`}>
                    <div>{m.text}</div>
                    <div className="bubble-time">
                      {m.from === 'bot' ? 'Assistant Selly · ' : m.from === 'vous' ? 'Vous · ' : ''}
                      {m.time}
                    </div>
                  </div>
                ))}
              </div>
              {!currentChat.handoff && (
                <div className="draft-note" style={{ margin: '10px 13px 0' }}>
                  L’assistant est actif. Reprenez la conversation pour lui demander de faire une
                  pause ici.
                </div>
              )}
              <form
                className="chat-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  onReply();
                }}
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    currentChat.handoff ? 'Écrire une réponse…' : 'Reprendre la main pour répondre…'
                  }
                  aria-label="Votre réponse"
                />
                <button
                  className="button primary small"
                  type="submit"
                  disabled={!currentChat.handoff || !reply.trim()}
                  aria-label="Envoyer la réponse"
                >
                  <Send size={14} />
                </button>
              </form>
            </>
          ) : (
            <Empty
              icon={MessageCircle}
              title="Choisissez une conversation"
              text="Sélectionnez un client pour voir ses messages."
            />
          )}
        </div>
      </div>
    </>
  );
}

function Catalogue({
  products,
  search,
  setSearch,
  add,
  onStock,
}: {
  products: Product[];
  search: string;
  setSearch: (s: string) => void;
  add: () => void;
  onStock: (name: string, delta: number) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Votre boutique · inventaire"
        title="Catalogue"
        description="Le stock disponible tient compte des articles déjà réservés."
        action={
          <button type="button" className="button primary" onClick={add}>
            <Plus size={15} /> Nouveau produit
          </button>
        }
      />
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            className="search"
            aria-label="Rechercher dans le catalogue"
            placeholder="Chercher un produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="demo-chip">{products.length} références affichées</span>
      </div>
      <div className="product-grid">
        {products.map((p) => (
          <article className="product-card" key={p.name}>
            <div className={`product-art ${p.tone}`}>
              <Package size={32} strokeWidth={1.3} />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: 10,
                  fontSize: 9,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                }}
              >
                {p.category}
              </span>
            </div>
            <div className="product-info">
              <h3>{p.name}</h3>
              <p>
                {p.available} disponibles · {p.reserved} réservés
              </p>
              <div className="product-meta">
                <span>{fmt(p.price)} XOF</span>
                <div className="table-actions">
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Retirer une unité de ${p.name}`}
                    onClick={() => onStock(p.name, -1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Ajouter une unité de ${p.name}`}
                    onClick={() => onStock(p.name, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      {products.length === 0 && (
        <div className="panel">
          <Empty
            icon={Package}
            title="Aucun produit correspondant"
            text="Essayez une autre recherche ou ajoutez une référence."
          />
        </div>
      )}
    </>
  );
}

function Drafts({
  drafts,
  search,
  setSearch,
  onConfirm,
  onDiscard,
}: {
  drafts: Draft[];
  search: string;
  setSearch: (s: string) => void;
  onConfirm: (d: Draft) => void;
  onDiscard: (d: Draft) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Assistant vendeur · à vérifier"
        title="Brouillons photo"
        description="Selly prépare une fiche à partir de la photo. Rien n’est publié avant votre confirmation."
      />
      <div className="draft-note">
        <b>Votre validation reste indispensable.</b> Vérifiez le nom, le prix et le stock détectés.
        La photo ci-dessous est une illustration de démonstration, pas une annonce publiée.
      </div>
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            className="search"
            aria-label="Rechercher un brouillon"
            placeholder="Chercher un brouillon…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="demo-chip">{drafts.length} à confirmer</span>
      </div>
      <div className="draft-grid">
        {drafts.map((d) => (
          <article className="product-card" key={d.id}>
            <div className="product-art draft-art">
              <ImagePlus size={29} strokeWidth={1.3} />
              <span style={{ position: 'absolute', right: 10, top: 10 }} className="status pending">
                À vérifier
              </span>
            </div>
            <div className="product-info">
              <h3>{d.name}</h3>
              <p>{d.detail}</p>
              <div className="product-meta">
                <span>{fmt(d.price)} XOF</span>
                <span>{d.stock} disponibles</span>
              </div>
              <div className="table-secondary">
                {d.category} · estimation proposée par l’assistant
              </div>
              <div className="draft-actions">
                <button type="button" className="button primary small" onClick={() => onConfirm(d)}>
                  <Check size={13} /> Confirmer
                </button>
                <button type="button" className="button small" onClick={() => onDiscard(d)}>
                  Supprimer
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {drafts.length === 0 && (
        <div className="panel">
          <Empty
            icon={CircleCheck}
            title="Tout est vérifié"
            text="Les nouveaux brouillons photo apparaîtront ici."
            action={
              <button type="button" className="button" onClick={() => setSearch('')}>
                Voir tous les brouillons
              </button>
            }
          />
        </div>
      )}
    </>
  );
}

function WalletPage({
  connected,
  open,
  flash,
}: {
  connected: boolean;
  open: () => void;
  flash: (s: string) => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="Bitcoin · Lightning"
        title="Portefeuille"
        description="Les paiements des clients vont directement dans votre wallet. Selly ne détient pas ces fonds."
        action={
          <button type="button" className="button primary" onClick={open}>
            <Link2 size={14} />
            {connected ? 'Gérer la liaison' : 'Lier un portefeuille'}
          </button>
        }
      />
      <div className="wallet-page-grid">
        <section className="panel wallet-hero">
          <div className="wallet-tag">
            <Bitcoin size={15} /> Portefeuille en réception uniquement
          </div>
          <div className="wallet-amount">
            {connected ? '128 450' : '—'} <span style={{ fontSize: 16 }}>sats</span>
          </div>
          <div className="wallet-sats">
            {connected
              ? '≈ 52 300 FCFA · estimation indicative'
              : 'Aucun solde affiché · liaison démo non effectuée'}
          </div>
          <button type="button" className="button olive" onClick={open}>
            {connected ? 'État de la connexion' : 'Découvrir la liaison'}
          </button>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">En toute simplicité</div>
              <div className="panel-sub">Ce que la liaison permet — et ne permet pas</div>
            </div>
          </div>
          <div className="info-list">
            <InfoRow label="Réception" value="Activée via votre wallet" />
            <InfoRow label="Solde affiché" value="Lecture seule" />
            <InfoRow label="Fonds détenus par Selly" value="Aucun" />
            <InfoRow label="Envoi depuis Selly" value="Non disponible" />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Activité récente</div>
              <div className="panel-sub">Exemple de paiements reçus</div>
            </div>
            <span className="demo-chip">Données fictives</span>
          </div>
          <div className="info-list">
            <InfoRow
              label={
                <>
                  <ArrowDownLeft size={14} /> SL-2840 · Sandales Téranga
                </>
              }
              value="+ 45 127 sats"
            />
            <InfoRow
              label={
                <>
                  <ArrowDownLeft size={14} /> SL-2838 · Ensemble Saly
                </>
              }
              value="+ 78 048 sats"
            />
            <InfoRow
              label={
                <>
                  <ArrowDownLeft size={14} /> SL-2836 · Pochette Baobab
                </>
              }
              value="+ 30 492 sats"
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">À propos du solde</div>
              <div className="panel-sub">Une estimation pour vous repérer</div>
            </div>
          </div>
          <div style={{ padding: '18px', fontSize: 12, lineHeight: 1.65, color: '#718078' }}>
            Le montant en XOF est indicatif et dépend du taux au moment de la commande. Pour
            vérifier un paiement ou rembourser un client, utilisez directement votre portefeuille.
            Selly ne déclenche ni remboursement ni transfert.
          </div>
        </section>
      </div>
      {connected && (
        <div className="draft-note" style={{ marginTop: 15 }}>
          État de connexion affiché en mode démo uniquement. Aucun portefeuille n’a réellement été
          lié et aucun secret n’a été demandé.
        </div>
      )}
      <button
        type="button"
        className="text-link"
        style={{ marginTop: 18 }}
        onClick={() => flash('Les connexions réelles seront proposées dans une version connectée.')}
      >
        En savoir plus sur Nostr Wallet Connect
      </button>
    </>
  );
}

function Subscription({ open }: { open: () => void; flash: (s: string) => void }) {
  return (
    <>
      <PageTitle
        eyebrow="Votre compte · Selly"
        title="Abonnement"
        description="Un abonnement prépayé en sats. Pas de débit automatique, pas de frais par commande."
      />
      <div className="wallet-page-grid">
        <section className="panel plan-card">
          <div className="eyebrow">Formule actuelle</div>
          <h2>Essentiel</h2>
          <p style={{ fontSize: 12, color: '#6f7e70', margin: 0 }}>
            Pour gérer votre boutique au quotidien.
          </p>
          <div
            className="product-meta"
            style={{ justifyContent: 'flex-start', gap: 8, marginTop: 19 }}
          >
            <strong style={{ fontSize: 23 }}>15 000 sats</strong>
            <span style={{ color: '#718078', fontWeight: 500 }}>/ mois</span>
          </div>
          <div className="usage-row">
            <div className="usage-top">
              <span>Conversations assistant</span>
              <b>188 / 300</b>
            </div>
            <div className="progress">
              <span style={{ width: '62.7%' }} />
            </div>
          </div>
          <div className="usage-row">
            <div className="usage-top">
              <span>Produits au catalogue</span>
              <b>18 / 50</b>
            </div>
            <div className="progress">
              <span style={{ width: '36%' }} />
            </div>
          </div>
          <button type="button" className="button primary" style={{ marginTop: 21 }} onClick={open}>
            <Zap size={14} /> Voir les options de paiement
          </button>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Échéance</div>
              <div className="panel-sub">Votre formule se renouvelle manuellement</div>
            </div>
          </div>
          <div className="info-list">
            <InfoRow label="État" value="Active · mode démo" />
            <InfoRow label="Prochaine échéance" value="30 novembre 2026" />
            <InfoRow label="Période" value="Mensuelle" />
            <InfoRow label="Paiement" value="Facture Lightning prépayée" />
          </div>
          <div className="draft-note" style={{ margin: '0 16px 16px' }}>
            Le renouvellement n’est jamais automatique. Vous choisissez une période et réglez une
            nouvelle facture lorsque vous le souhaitez.
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Choisir une période</div>
              <div className="panel-sub">
                Les prix ci-dessous sont des exemples de démonstration.
              </div>
            </div>
          </div>
          <div className="info-list">
            <PeriodRow label="1 mois" price="15 000 sats" onClick={open} />
            <PeriodRow label="3 mois" price="40 500 sats" onClick={open} />
            <PeriodRow label="12 mois" price="150 000 sats" onClick={open} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Ce qui est inclus</div>
              <div className="panel-sub">La formule suit votre activité.</div>
            </div>
          </div>
          <div className="info-list">
            <InfoRow label="Mini-boutique partageable" value="Incluse" />
            <InfoRow label="Assistant sur le site" value="300 échanges / mois" />
            <InfoRow label="Gestion commandes & stock" value="Incluse" />
            <InfoRow label="Frais Selly par vente" value="Aucun" />
          </div>
        </section>
      </div>
    </>
  );
}

function PeriodRow({
  label,
  price,
  onClick,
}: {
  label: string;
  price: string;
  onClick: () => void;
}) {
  return (
    <div className="info-row" style={{ alignItems: 'center' }}>
      <span>{label}</span>
      <b>{price}</b>
      <button type="button" className="button small" onClick={onClick}>
        Choisir
      </button>
    </div>
  );
}

function InfoRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="info-row">
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{label}</span>
      <b style={{ textAlign: 'right' }}>{value}</b>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: IconComponent;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={24} strokeWidth={1.5} />
      <strong>{title}</strong>
      {text}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

function Modal({
  type,
  onClose,
  connected,
  setConnected,
  newProduct,
  setNewProduct,
  createProduct,
  flash,
}: {
  type: ModalType;
  onClose: () => void;
  connected: boolean;
  setConnected: (v: boolean) => void;
  newProduct: NewProduct;
  setNewProduct: (p: NewProduct) => void;
  createProduct: (e: FormEvent) => void;
  flash: (s: string) => void;
}) {
  const titles: Record<ModalType, string> = {
    wallet: connected ? 'Portefeuille de démonstration' : 'Lier votre portefeuille',
    product: 'Ajouter un produit',
    subscription: 'Choisir votre abonnement',
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{titles[type]}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </div>
        {type === 'wallet' && (
          <>
            <p className="modal-copy">
              Selly lit votre solde et crée des factures de réception dans votre portefeuille. Cette
              maquette n’établit aucune connexion réelle.
            </p>
            <div className="draft-note">
              <b>Ne collez jamais de NWC URI ici.</b> Elle contient un secret qui autorise l’accès
              au wallet. L’application connectée utilisera un parcours sécurisé, limité à la
              réception.
            </div>
            <div className="info-row">
              <span>Mode de cette maquette</span>
              <b>Démo locale seulement</b>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 17 }}>
              <button type="button" className="button" onClick={onClose}>
                Annuler
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setConnected(!connected);
                  onClose();
                  flash(
                    connected
                      ? 'L’état démo a été retiré.'
                      : 'État de connexion démo activé. Aucun wallet réellement lié.',
                  );
                }}
              >
                {connected ? 'Retirer l’état démo' : 'Simuler la liaison'}
              </button>
            </div>
          </>
        )}
        {type === 'product' && (
          <form onSubmit={createProduct}>
            <p className="modal-copy">
              Ajoutez une référence à votre catalogue. Ce produit reste dans les données locales de
              la démonstration.
            </p>
            <label className="form-label">
              Nom du produit
              <input
                className="form-control"
                required
                value={newProduct.name}
                onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                placeholder="Ex. Sac de voyage"
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="form-label">
                Prix (XOF)
                <input
                  className="form-control"
                  type="number"
                  min="1"
                  required
                  value={newProduct.price}
                  onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                  placeholder="25000"
                />
              </label>
              <label className="form-label">
                Stock disponible
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  value={newProduct.stock}
                  onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                  placeholder="0"
                />
              </label>
            </div>
            <label className="form-label">
              Catégorie
              <select
                className="form-control"
                value={newProduct.category}
                onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
              >
                <option>Accessoires</option>
                <option>Maroquinerie</option>
                <option>Chaussures</option>
                <option>Prêt-à-porter</option>
              </select>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 17 }}>
              <button type="button" className="button" onClick={onClose}>
                Annuler
              </button>
              <button className="button primary" type="submit">
                <Plus size={14} /> Ajouter au catalogue
              </button>
            </div>
          </form>
        )}
        {type === 'subscription' && (
          <>
            <p className="modal-copy">
              Choisissez une durée puis payez une facture Lightning prépayée. Rien ne sera débité
              automatiquement.
            </p>
            <div className="draft-note">
              Les options de paiement sont désactivées dans cette maquette. Aucun paiement de
              souscription n’a été créé.
            </div>
            <div className="info-list" style={{ padding: 0 }}>
              <InfoRow label="Mensuel" value="15 000 sats" />
              <InfoRow label="Trimestriel" value="40 500 sats" />
              <InfoRow label="Annuel" value="150 000 sats" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="button" onClick={onClose}>
                Fermer
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  onClose();
                  flash('Paiement non disponible en mode démo.');
                }}
              >
                Continuer en démo <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
