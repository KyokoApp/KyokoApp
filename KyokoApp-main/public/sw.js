// KyokoMd Global - Service Worker
// Handles push notifications

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Handle push event dari server (jika pakai FCM/Web Push)
self.addEventListener('push', (event) => {
  let data = { title: 'KyokoMd Global', body: 'Ada pesan baru!', icon: '/icon-192x192.png' }
  if (event.data) {
    try { data = { ...data, ...event.data.json() } } catch {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192x192.png',
      badge: '/icon-72x72.png',
      vibrate: [200, 100, 200],
      tag: 'kyokomd-chat',
      renotify: true,
      data: { url: self.location.origin }
    })
  )
})

// Klik notif → buka/fokus tab web
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data?.url || '/')
      }
    })
  )
})

// Receive message dari app (untuk trigger notif lokal)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIF') {
    const { title, body, icon } = event.data
    self.registration.showNotification(title || 'KyokoMd Global', {
      body: body || 'Ada pesan baru!',
      icon: icon || '/icon-192x192.png',
      badge: '/icon-72x72.png',
      vibrate: [150, 50, 150],
      tag: 'kyokomd-chat',
      renotify: true,
      data: { url: self.location.origin }
    })
  }
})
