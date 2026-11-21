'use client';
import { useEffect } from 'react';
import { session } from '@/lib/api';

export default function Home() {
  useEffect(() => {
    const token = session.token();
    const user = session.user();
    if (!token) {
      window.location.replace('/login');
      return;
    }
    window.location.replace(user?.wajib_ganti_password ? '/akun' : '/chat');
  }, []);
  return null;
}
