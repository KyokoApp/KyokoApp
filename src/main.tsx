import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode dihapus dari production build — di dev silahkan aktifkan kembali.
// StrictMode menyebabkan double-invoke effect/render yang tidak perlu di production.
createRoot(document.getElementById('root')!).render(
  <App />
)
