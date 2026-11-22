import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'SIS SMKN 4 Bandung',
  description: 'School Intelligence System kelas XII SMKN 4 Bandung',
};

const FOUC_SCRIPT = `(function(){try{var s=localStorage.getItem('sis_color_scheme');var v=(s==='light'||s==='dark')?s:'light dark';var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content=v;var r=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=r;var d=localStorage.getItem('sis_table_density');document.documentElement.dataset.density=(d==='compact')?'compact':'comfortable';}catch(e){try{var rk=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=rk;}catch(_){}}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
