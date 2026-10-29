import { post } from '@/api/client'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '기기'
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '브라우저'
  return `${os} · ${browser}`
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub?.endpoint ?? null
}

export async function enablePush(publicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error('이 브라우저는 알림을 지원하지 않아요.')
  if (!window.isSecureContext) throw new Error('알림은 https 주소(Tailscale) 또는 이 PC에서만 켤 수 있어요.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('알림이 차단돼 있어요. 브라우저/앱 설정에서 RoutineLab 알림을 허용해 주세요.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  const json = sub.toJSON()
  await post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() })
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await post('/push/unsubscribe', { endpoint: sub.endpoint })
  await sub.unsubscribe()
}
