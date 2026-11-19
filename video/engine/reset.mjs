// Puts the local demo shop back as it was before the video's takes: no white sneakers, no order or chat about
// them, an empty assistant conversation. Dev only: it writes straight into the local database, like the demo seed.
//
//   node engine/reset.mjs
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DB_CONTAINER = process.env.DB_CONTAINER ?? 'selly-postgres-1';
const SLUG = 'maison-sokhna';
const PRODUCT = 'White sneakers';

export function sql(query) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'selly',
      '-d',
      'selly',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  ).trim();
}

export function reset() {
  const vendor = `(select id from core.vendors where slug = '${SLUG}')`;
  const products = `(select id from core.products where vendor_id = ${vendor} and title = '${PRODUCT}')`;
  const variants = `(select id from core.product_variants where product_id in ${products})`;
  const orders = `(select distinct order_id from core.order_items where variant_id in ${variants})`;
  // Customer chats of the takes: the ones about the sneakers.
  const chats = `(select c.id from agent.conversations c where c.vendor_id = ${vendor} and c.role = 'customer'
    and (c.state->>'productInView' in (select id::text from ${products} p)
      or exists (select 1 from agent.messages m where m.conversation_id = c.id and m.text ilike '%sneakers%')))`;
  const assistant = `(select id from agent.conversations where vendor_id = ${vendor} and role = 'vendor')`;
  return sql(`begin;
create temp table gone_chats on commit drop as select id from ${chats};
create temp table gone_orders on commit drop as select order_id as id from ${orders};
delete from agent.messages where conversation_id in (select id from gone_chats);
delete from agent.chat_sessions where conversation_id in (select id from gone_chats);
delete from agent.conversations where id in (select id from gone_chats);
delete from agent.messages where conversation_id in ${assistant};
update agent.conversations set state = '{}'::jsonb, summary = '' where id in ${assistant};
delete from core.invoices where order_id in (select id from gone_orders);
delete from core.orders where id in (select id from gone_orders);
delete from core.inventory_movements where variant_id in ${variants};
delete from core.product_drafts where vendor_id = ${vendor}
  and (target_product_id in ${products} or input_text ilike '%sneakers%' or status <> 'confirmed');
delete from core.products where id in ${products};
select (select count(*) from gone_orders) || ' orders, ' || (select count(*) from gone_chats) || ' chats removed';
commit;`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(reset());
