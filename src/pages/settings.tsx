import { ShieldCheck, Smartphone } from 'lucide-react';
import { stateName } from '../lib/rules';
import { useApp } from '../state/store';
import { navigate } from '../state/nav';
import { activeBiz } from '../state/select';
import { setSettings } from '../state/actions';
import { QR } from '../paper';
import { Button, Chip, PageHeader, Panel, Segmented, Switch, ic } from '../ui';

export function SettingsPage() {
  const s = useApp();
  const biz = activeBiz(s);
  const accountant = s.persona === 'accountant';
  return (
    <>
      <PageHeader title="Settings" sub={biz ? biz.name : s.firm.name} />
      <div className="cols">
        <div className="col-main stack">
          {biz ? (
            <Panel title="Business" sub="What goes on every e-invoice as the supplier." pad>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{biz.name}</dd>
                <dt>TIN</dt>
                <dd className="mono">{biz.tin}</dd>
                <dt>BRN</dt>
                <dd className="mono">{biz.brn}</dd>
                <dt>MSIC code</dt>
                <dd>
                  {biz.msic}, {biz.msicName}
                </dd>
                <dt>Address</dt>
                <dd>
                  {biz.address.line1}, {biz.address.postcode} {biz.address.city}, {stateName(biz.address.state)}
                </dd>
                <dt>Phone</dt>
                <dd>{biz.phone}</dd>
                <dt>Email</dt>
                <dd>{biz.email}</dd>
                <dt>Rollout phase</dt>
                <dd>Phase {biz.phase}</dd>
                <dt>Branches</dt>
                <dd>{biz.branches.map((b) => `${b.name} (receipts ${b.prefix}…)`).join(', ')}</dd>
              </dl>
            </Panel>
          ) : (
            <Panel title="Firm" pad>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{s.firm.name}</dd>
                <dt>TIN</dt>
                <dd className="mono">{s.firm.tin}</dd>
                <dt>Signed in as</dt>
                <dd>
                  {s.firm.user.name}, {s.firm.user.role}
                </dd>
                <dt>Clients</dt>
                <dd>{s.clients.length}</dd>
              </dl>
            </Panel>
          )}

          <Panel title="MyInvois connection" actions={<Chip tone="info" icon={ic(ShieldCheck, 'ico-sm')}>Simulated</Chip>} pad>
            <div className="stack">
              <p className="hint">
                This demo answers like MyInvois does: it accepts a submission at once, then validates each document a moment later with the same field rules. No LHDN account is
                used and nothing leaves this page.
              </p>
              <dl className="kv">
                <dt>Environment</dt>
                <dd>Sandbox, simulated</dd>
                <dt>Signing in</dt>
                <dd>{accountant ? `As intermediary for ${biz ? biz.short : 'each client'}` : 'As the taxpayer'}</dd>
                <dt>Validation</dt>
                <dd>Asynchronous, about {s.settings.speed === 'quick' ? 'half a second' : 'two seconds'} per document</dd>
              </dl>
            </div>
          </Panel>

          {biz && (
            <Panel title="Receipt QR codes" sub="Printed on every receipt. Scanning one opens the buyer's request page with the sale filled in.">
              <div className="pad" style={{ paddingTop: 0 }}>
                <div className="qr-grid">
                  {biz.branches.map((b) => (
                    <figure key={b.id} className="qr-card">
                      <QR text={`SAHKAN DEMO receipt QR for ${biz.short}, ${b.name}. Sample only.`} size={120} label={`Sample receipt QR code for ${b.name}`} />
                      <figcaption>
                        <span className="strong" style={{ display: 'block' }}>{b.name}</span>
                        <span className="small">Receipts {b.prefix}…</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <Button icon={ic(Smartphone, 'ico-sm')} onClick={() => navigate({ name: 'buyer' })} id="settings-buyer">
                  See the buyer's page
                </Button>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-side stack">
          {biz && (
            <section className="panel pad stack" aria-label="Buyer requests">
              <h2 className="h2">Buyer requests</h2>
              <Switch
                id="settings-auto"
                checked={s.settings.autoIssue}
                onChange={(v) => setSettings({ autoIssue: v })}
                label="Issue automatically"
                hint="When the buyer's TIN checks out, the e-invoice goes to LHDN without waiting for you."
              />
            </section>
          )}
          <section className="panel pad stack" aria-label="Demo controls">
            <h2 className="h2">Demo controls</h2>
            <div className="field">
              <span className="label" id="speed-label">
                LHDN answer speed
              </span>
              <Segmented
                id="settings-speed"
                label="LHDN answer speed"
                value={s.settings.speed}
                options={[
                  { value: 'realistic', label: 'Realistic' },
                  { value: 'quick', label: 'Quick' },
                ]}
                onChange={(v) => setSettings({ speed: v })}
              />
            </div>
            <Switch
              id="settings-reject"
              checked={s.settings.rejectNext}
              onChange={(v) => setSettings({ rejectNext: v })}
              label="Reject the next e-invoice"
              hint="See what a rejection looks like. It switches itself off after one use."
            />
            <p className="hint">To start over, use Reset in the bar at the top.</p>
          </section>
        </div>
      </div>
    </>
  );
}
