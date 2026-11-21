import { useEffect, useState } from 'react';

export function useOffline() {
  const [online, setOnline] = useState(navigator.onLine);
  const [cacheState, setCacheState] = useState<'loading' | 'ready' | 'unavailable' | 'dev'>(import.meta.env.PROD ? 'loading' : 'dev');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: MessageChannel | undefined;
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    const confirmCache = () => {
      if (!navigator.serviceWorker.controller) return;
      channel?.port1.close();
      channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (active && event.data?.ready === true) { setCacheState('ready'); clearTimeout(timer); }
        channel?.port1.close();
      };
      navigator.serviceWorker.controller.postMessage('CACHE_READY', [channel.port2]);
    };
    if (import.meta.env.PROD) {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) setCacheState('unavailable');
      else {
        timer = setTimeout(() => { if (active) setCacheState('unavailable'); }, 15_000);
        navigator.serviceWorker.addEventListener('controllerchange', confirmCache);
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(() => navigator.serviceWorker.ready).then(() => { if (active) confirmCache(); }).catch(() => { if (active) setCacheState('unavailable'); });
        confirmCache();
      }
    }
    return () => {
      active = false;
      clearTimeout(timer);
      channel?.port1.close();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', confirmCache);
    };
  }, []);
  return { online, cacheState };
}
