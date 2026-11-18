'use client';

import { Title } from '@/components/dashboard/ui';
import { dash } from '@/lib/i18n/dashboard';

export default function HomePage() {
  return <Title>{dash.home.title}</Title>;
}
