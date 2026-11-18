// Lucide icons used by the storefront draft (ISC licence, lucide.dev), as inline SVG: same paths and defaults as
// lucide-react (24 px box, stroke 2, round caps), without the dependency.

import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };
type Node = [string, Record<string, string>];

function make(nodes: Node[]) {
  return function Icon({ size = 24, strokeWidth = 2, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {nodes.map(([tag, { key, ...attrs }]) => {
          const Tag = tag as 'path';
          return <Tag key={key} {...attrs} />;
        })}
      </svg>
    );
  };
}

export const ArrowDownRight = make([
  ['path', { d: 'm7 7 10 10', key: '1fmybs' }],
  ['path', { d: 'M17 7v10H7', key: '6fjiku' }],
]);
export const ArrowRight = make([
  ['path', { d: 'M5 12h14', key: '1ays0h' }],
  ['path', { d: 'm12 5 7 7-7 7', key: 'xquz4c' }],
]);
export const ArrowUpRight = make([
  ['path', { d: 'M7 7h10v10', key: '1tivn9' }],
  ['path', { d: 'M7 17 17 7', key: '1vkiza' }],
]);
export const BadgeCheck = make([
  [
    'path',
    {
      d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z',
      key: '3c2336',
    },
  ],
  ['path', { d: 'm9 12 2 2 4-4', key: 'dzmm74' }],
]);
export const ChevronDown = make([['path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' }]]);
export const CircleHelp = make([
  ['circle', { cx: '12', cy: '12', r: '10', key: '1mglay' }],
  ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', key: '1u773s' }],
  ['path', { d: 'M12 17h.01', key: 'p32p05' }],
]);
export const Clock3 = make([
  ['path', { d: 'M12 6v6h4', key: '135r8i' }],
  ['circle', { cx: '12', cy: '12', r: '10', key: '1mglay' }],
]);
export const Flower2 = make([
  [
    'path',
    {
      d: 'M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1',
      key: '3pnvol',
    },
  ],
  ['circle', { cx: '12', cy: '8', r: '2', key: '1822b1' }],
  ['path', { d: 'M12 10v12', key: '6ubwww' }],
  ['path', { d: 'M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z', key: '9hd38g' }],
  ['path', { d: 'M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z', key: 'ufn41s' }],
]);
export const Heart = make([
  [
    'path',
    {
      d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
      key: 'mvr1a0',
    },
  ],
]);
export const MapPin = make([
  [
    'path',
    {
      d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
      key: '1r0f0z',
    },
  ],
  ['circle', { cx: '12', cy: '10', r: '3', key: 'ilqhr7' }],
]);
export const Menu = make([
  ['path', { d: 'M4 5h16', key: '1tepv9' }],
  ['path', { d: 'M4 12h16', key: '1lakjw' }],
  ['path', { d: 'M4 19h16', key: '1djgab' }],
]);
export const MessageCircle = make([
  [
    'path',
    {
      d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
      key: '1sd12s',
    },
  ],
]);
export const Minus = make([['path', { d: 'M5 12h14', key: '1ays0h' }]]);
export const PackageCheck = make([
  ['path', { d: 'm16 16 2 2 4-4', key: 'gfu2re' }],
  [
    'path',
    {
      d: 'M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14',
      key: 'e7tb2h',
    },
  ],
  ['path', { d: 'm7.5 4.27 9 5.15', key: '1c824w' }],
  ['polyline', { points: '3.29 7 12 12 20.71 7', key: 'ousv84' }],
  ['line', { x1: '12', x2: '12', y1: '22', y2: '12', key: 'a4e8g8' }],
]);
export const Plus = make([
  ['path', { d: 'M5 12h14', key: '1ays0h' }],
  ['path', { d: 'M12 5v14', key: 's699le' }],
]);
export const Search = make([
  ['path', { d: 'm21 21-4.34-4.34', key: '14j7rj' }],
  ['circle', { cx: '11', cy: '11', r: '8', key: '4ej97u' }],
]);
export const Send = make([
  [
    'path',
    {
      d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      key: '1ffxy3',
    },
  ],
  ['path', { d: 'm21.854 2.147-10.94 10.939', key: '12cjpa' }],
]);
export const ShoppingBag = make([
  ['path', { d: 'M16 10a4 4 0 0 1-8 0', key: '1ltviw' }],
  ['path', { d: 'M3.103 6.034h17.794', key: 'awc11p' }],
  [
    'path',
    {
      d: 'M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z',
      key: 'o988cm',
    },
  ],
]);
export const ShoppingCart = make([
  ['circle', { cx: '8', cy: '21', r: '1', key: 'jimo8o' }],
  ['circle', { cx: '19', cy: '21', r: '1', key: '13723u' }],
  [
    'path',
    {
      d: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
      key: '9zh506',
    },
  ],
]);
export const Sparkles = make([
  [
    'path',
    {
      d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      key: '1s2grr',
    },
  ],
  ['path', { d: 'M20 2v4', key: '1rf3ol' }],
  ['path', { d: 'M22 4h-4', key: 'gwowj6' }],
  ['circle', { cx: '4', cy: '20', r: '2', key: '6kqj1y' }],
]);
export const Store = make([
  ['path', { d: 'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5', key: 'slp6dd' }],
  [
    'path',
    {
      d: 'M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
      key: 'o0xfot',
    },
  ],
  ['path', { d: 'M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05', key: 'wn3emo' }],
]);
export const X = make([
  ['path', { d: 'M18 6 6 18', key: '1bl5f8' }],
  ['path', { d: 'm6 6 12 12', key: 'd8bk6v' }],
]);
