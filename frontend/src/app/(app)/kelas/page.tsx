'use client';
import MasterNav from '@/components/master/MasterNav';
import KelasView from '@/components/master/KelasView';

export default function Kelas() {
  return (
    <div className="space-y-4">
      <MasterNav active="kelas" />
      <KelasView />
    </div>
  );
}
