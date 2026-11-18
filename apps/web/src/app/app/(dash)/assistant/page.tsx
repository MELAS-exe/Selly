import { redirect } from 'next/navigation';

// The assistant is Selly, over every dashboard page: this address opens it on the home page.
export default function Page() {
  redirect('/app?selly=1');
}
