// Lucide icons (ISC licence): the paths the dashboard draft used, without the lucide-react dependency.
import type { SVGProps } from 'react';

type IconNode = [string, Record<string, string>][];
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };
export type IconComponent = (props: IconProps) => React.JSX.Element;

function icon(nodes: IconNode): IconComponent {
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
        {nodes.map(([tag, attrs]) => {
          const Tag = tag as 'path';
          return <Tag key={JSON.stringify(attrs)} {...attrs} />;
        })}
      </svg>
    );
  };
}

export const ArrowDownLeft = icon([
  ['path', { d: 'M17 7 7 17' }],
  ['path', { d: 'M17 17H7V7' }],
]);
export const ArrowRight = icon([
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'm12 5 7 7-7 7' }],
]);
export const ArrowUpRight = icon([
  ['path', { d: 'M7 7h10v10' }],
  ['path', { d: 'M7 17 17 7' }],
]);
export const Bell = icon([
  ['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }],
  [
    'path',
    {
      d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    },
  ],
]);
export const Bitcoin = icon([
  [
    'path',
    {
      d: 'M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727',
    },
  ],
]);
export const Check = icon([['path', { d: 'M20 6 9 17l-5-5' }]]);
export const CircleCheck = icon([
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'm9 12 2 2 4-4' }],
]);
export const CircleHelp = icon([
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
  ['path', { d: 'M12 17h.01' }],
]);
export const Clock = icon([
  ['path', { d: 'M12 6v6h4' }],
  ['circle', { cx: '12', cy: '12', r: '10' }],
]);
export const Ellipsis = icon([
  ['circle', { cx: '12', cy: '12', r: '1' }],
  ['circle', { cx: '19', cy: '12', r: '1' }],
  ['circle', { cx: '5', cy: '12', r: '1' }],
]);
export const Hand = icon([
  ['path', { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' }],
  ['path', { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2' }],
  ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' }],
  [
    'path',
    {
      d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
    },
  ],
]);
export const Headset = icon([
  [
    'path',
    {
      d: 'M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z',
    },
  ],
  ['path', { d: 'M21 16v2a4 4 0 0 1-4 4h-5' }],
]);
export const ImagePlus = icon([
  ['path', { d: 'M16 5h6' }],
  ['path', { d: 'M19 2v6' }],
  ['path', { d: 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ['circle', { cx: '9', cy: '9', r: '2' }],
]);
export const LayoutDashboard = icon([
  ['rect', { width: '7', height: '9', x: '3', y: '3', rx: '1' }],
  ['rect', { width: '7', height: '5', x: '14', y: '3', rx: '1' }],
  ['rect', { width: '7', height: '9', x: '14', y: '12', rx: '1' }],
  ['rect', { width: '7', height: '5', x: '3', y: '16', rx: '1' }],
]);
export const Link2 = icon([
  ['path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }],
  ['path', { d: 'M15 7h2a5 5 0 1 1 0 10h-2' }],
  ['line', { x1: '8', x2: '16', y1: '12', y2: '12' }],
]);
export const MessageCircle = icon([
  [
    'path',
    {
      d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
    },
  ],
]);
export const PackageCheck = icon([
  ['path', { d: 'm16 16 2 2 4-4' }],
  [
    'path',
    {
      d: 'M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14',
    },
  ],
  ['path', { d: 'm7.5 4.27 9 5.15' }],
  ['polyline', { points: '3.29 7 12 12 20.71 7' }],
  ['line', { x1: '12', x2: '12', y1: '22', y2: '12' }],
]);
export const Package = icon([
  [
    'path',
    {
      d: 'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
    },
  ],
  ['path', { d: 'M12 22V12' }],
  ['polyline', { points: '3.29 7 12 12 20.71 7' }],
  ['path', { d: 'm7.5 4.27 9 5.15' }],
]);
export const Plus = icon([
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M12 5v14' }],
]);
export const Search = icon([
  ['path', { d: 'm21 21-4.34-4.34' }],
  ['circle', { cx: '11', cy: '11', r: '8' }],
]);
export const Send = icon([
  [
    'path',
    {
      d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
    },
  ],
  ['path', { d: 'm21.854 2.147-10.94 10.939' }],
]);
export const Settings2 = icon([
  ['path', { d: 'M14 17H5' }],
  ['path', { d: 'M19 7h-9' }],
  ['circle', { cx: '17', cy: '17', r: '3' }],
  ['circle', { cx: '7', cy: '7', r: '3' }],
]);
export const ShoppingBag = icon([
  ['path', { d: 'M16 10a4 4 0 0 1-8 0' }],
  ['path', { d: 'M3.103 6.034h17.794' }],
  [
    'path',
    {
      d: 'M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z',
    },
  ],
]);
export const Sparkles = icon([
  [
    'path',
    {
      d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    },
  ],
  ['path', { d: 'M20 2v4' }],
  ['path', { d: 'M22 4h-4' }],
  ['circle', { cx: '4', cy: '20', r: '2' }],
]);
export const Wallet = icon([
  [
    'path',
    {
      d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
    },
  ],
  ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' }],
]);
export const X = icon([
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
]);
export const Zap = icon([
  [
    'path',
    {
      d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
    },
  ],
]);
