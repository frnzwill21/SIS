'use client';
import MasterNav from '@/components/master/MasterNav';
import SiswaView from '@/components/master/SiswaView';

export default function SiswaList() {
  return (
    <div className="space-y-4">
      <MasterNav active="siswa" />
      <SiswaView />
    </div>
  );
}
