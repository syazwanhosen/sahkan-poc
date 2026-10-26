import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { getState, initStore, setState } from './state/store';
import { initRoute, type Route } from './state/nav';
import { resumePending } from './state/actions';

initStore();

// A plain #token on the link opens one view directly, e.g. #clients or #monthend.
const TOKENS: Record<string, Route> = {
  today: { name: 'today' },
  invoices: { name: 'invoices' },
  new: { name: 'compose' },
  requests: { name: 'requests' },
  buyer: { name: 'buyer' },
  monthend: { name: 'monthend' },
  buyers: { name: 'buyers' },
  items: { name: 'items' },
  settings: { name: 'settings' },
  clients: { name: 'clients' },
};
let token = '';
try {
  token = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim().toLowerCase();
} catch {
  token = '';
}
const start = TOKENS[token];
if (start) {
  if (start.name === 'clients') setState((s) => ({ ...s, persona: 'accountant', activeBizId: null }));
  else if (!getState().activeBizId) setState((s) => ({ ...s, activeBizId: 'jaya' }));
  initRoute(start);
} else if (getState().persona === 'accountant' && !getState().activeBizId) {
  initRoute({ name: 'clients' });
}

resumePending();
createRoot(document.getElementById('root')!).render(<App />);
