import { Fragment } from 'react';
import { useApp } from './state/store';
import { useRoute } from './state/nav';
import { activeBiz } from './state/select';
import { Shell } from './shell';
import { TodayPage } from './pages/today';
import { InvoicesPage } from './pages/invoices';
import { ComposePage } from './pages/composer';
import { DocPage } from './pages/detail';
import { BuyerPage, RequestsPage } from './pages/requests';
import { ReceivedPage } from './pages/received';
import { MonthEndPage } from './pages/monthend';
import { ClientsPage } from './pages/clients';
import { BuyersPage, ItemsPage } from './pages/directory';
import { SettingsPage } from './pages/settings';

export function App() {
  const s = useApp();
  const { route, key } = useRoute();
  const biz = activeBiz(s);

  let page;
  if (route.name === 'settings') page = <SettingsPage />;
  else if (!biz || route.name === 'clients') page = s.persona === 'accountant' ? <ClientsPage /> : <TodayPage />;
  else {
    switch (route.name) {
      case 'invoices':
        page = <InvoicesPage filter={route.filter} q={route.q} />;
        break;
      case 'compose':
        page = <ComposePage type={route.type} fromId={route.fromId} editId={route.editId} buyerId={route.buyerId} />;
        break;
      case 'doc':
        page = <DocPage id={route.id} tab={route.tab} />;
        break;
      case 'requests':
        page = <RequestsPage />;
        break;
      case 'received':
        page = <ReceivedPage id={route.id} />;
        break;
      case 'buyer':
        page = <BuyerPage />;
        break;
      case 'monthend':
        page = <MonthEndPage runId={route.runId} />;
        break;
      case 'buyers':
        page = <BuyersPage />;
        break;
      case 'items':
        page = <ItemsPage />;
        break;
      default:
        page = <TodayPage />;
    }
  }
  return (
    <Shell>
      <Fragment key={key}>{page}</Fragment>
    </Shell>
  );
}
