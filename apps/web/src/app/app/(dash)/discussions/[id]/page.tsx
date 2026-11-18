'use client';

import { useParams } from 'next/navigation';
import { Chats } from '@/components/dashboard/chats';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  return <Chats selectedId={id} />;
}
