import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MotionDemo } from './motion-demo';

export const metadata: Metadata = { title: 'Animations', robots: { index: false } };

/** Every motion building block in every state, to film the demo. Development only. */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <MotionDemo />;
}
