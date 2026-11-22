'use client';
import MasterNav from '@/components/master/MasterNav';
import ProfilSekolahView from '@/components/master/ProfilSekolahView';

export default function ProfilSekolahPage() {
  return (
    <div className="space-y-4">
      <MasterNav active="profil" />
      <ProfilSekolahView />
    </div>
  );
}
