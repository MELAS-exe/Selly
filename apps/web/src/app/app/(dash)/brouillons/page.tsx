import { redirect } from 'next/navigation';

// Photo drafts are made with Selly (the assistant over every page); the ones left to check sit in the catalogue.
export default function Page() {
  redirect('/app/catalogue#brouillons');
}
