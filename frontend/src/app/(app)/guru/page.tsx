'use client';
import MasterNav from '@/components/master/MasterNav';
import GuruView from '@/components/master/GuruView';

export default function GuruPage() {
  return (
    <div className="space-y-4">
      <MasterNav active="guru" />
      <GuruView />
    </div>
  );
}
