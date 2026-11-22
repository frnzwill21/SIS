'use client';
import MasterNav from '@/components/master/MasterNav';
import EkskulView from '@/components/master/EkskulView';

export default function Ekskul() {
  return (
    <div className="space-y-4">
      <MasterNav active="ekskul" />
      <EkskulView />
    </div>
  );
}
