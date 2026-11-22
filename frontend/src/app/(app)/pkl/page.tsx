'use client';
import MasterNav from '@/components/master/MasterNav';
import PklView from '@/components/master/PklView';

export default function Pkl() {
  return (
    <div className="space-y-4">
      <MasterNav active="pkl" />
      <PklView />
    </div>
  );
}
