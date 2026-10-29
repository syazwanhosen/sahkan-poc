// Digital signature for document version 1.1, following the SDK's "Signing a JSON document":
// digest the minified document without UBLExtensions and Signature, sign it with RSA-SHA256,
// digest the certificate and the signed properties, then add both sections at the end.
import { X509Certificate, createHash, createPrivateKey, sign as rsaSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MyInvoisError } from './client.js';
import type { Pem } from './config.js';

type Json = Record<string, unknown>;

const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const XADES = 'urn:oasis:names:specification:ubl:dsig:enveloped:xades';
const SIG_INVOICE = 'urn:oasis:names:specification:ubl:signature:Invoice';

const v = (value: string, attrs?: Record<string, string>) => [{ _: value, ...(attrs ?? {}) }];
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('base64');

/** "C=MY\nO=LHDNM\nCN=..." as the SDK samples write it: "CN=..., O=LHDNM, C=MY". */
const dn = (name: string) => name.split('\n').reverse().join(', ');
const read = (p: Pem) => ('text' in p ? p.text : readFileSync(p.file));

export interface SignerInfo {
  subject: string;
  organization?: string;
  tin?: string;
  brn?: string;
  issuer: string;
  validTo: string;
}

export interface Signer {
  info: SignerInfo;
  sign(ubl: Json): Json;
}

export function loadSigner(certPem: Pem, keyPem: Pem, passphrase?: string): Signer {
  let cert: X509Certificate;
  let key: ReturnType<typeof createPrivateKey>;
  try {
    cert = new X509Certificate(read(certPem));
    key = createPrivateKey({ key: read(keyPem), passphrase });
  } catch (e) {
    throw new MyInvoisError(503, 'SigningNotReady', `Can't load the signing certificate or key: ${(e as Error).message}`);
  }
  if (!cert.checkPrivateKey(key)) throw new MyInvoisError(503, 'SigningNotReady', "The private key doesn't belong to the signing certificate.");

  const subject: Record<string, string> = {};
  for (const line of cert.subject.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) subject[line.slice(0, i)] = line.slice(i + 1);
  }
  const issuerName = dn(cert.issuer);
  const serial = BigInt(`0x${cert.serialNumber}`).toString();
  const certDigest = digest(cert.raw);
  const certB64 = cert.raw.toString('base64');

  return {
    info: {
      subject: subject.CN ?? dn(cert.subject),
      organization: subject.O,
      tin: subject.organizationIdentifier ?? subject['2.5.4.97'],
      brn: subject.serialNumber,
      issuer: issuerName,
      validTo: new Date(cert.validTo).toISOString(),
    },
    sign(ubl) {
      const invoices = ubl.Invoice as Json[] | undefined;
      if (!invoices?.[0]) throw new MyInvoisError(400, 'BadDocument', 'The document has no Invoice element to sign.');
      const { UBLExtensions: _x, Signature: _s, ...inv } = invoices[0];
      const bytes = Buffer.from(JSON.stringify({ ...ubl, Invoice: [inv] }), 'utf8');
      const docDigest = digest(bytes);
      const signature = rsaSign('sha256', bytes, key).toString('base64');
      const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const issuerSerial = [{ X509IssuerName: v(issuerName), X509SerialNumber: v(serial) }];
      const qualifying = {
        Target: 'signature',
        SignedProperties: [
          {
            Id: 'id-xades-signed-props',
            SignedSignatureProperties: [
              {
                SigningTime: v(signingTime),
                SigningCertificate: [{ Cert: [{ CertDigest: [{ DigestMethod: v('', { Algorithm: SHA256 }), DigestValue: v(certDigest) }], IssuerSerial: issuerSerial }] }],
              },
            ],
          },
        ],
      };
      const propsDigest = digest(JSON.stringify(qualifying));
      const dsSignature = {
        Id: 'signature',
        Object: [{ QualifyingProperties: [qualifying] }],
        KeyInfo: [{ X509Data: [{ X509Certificate: v(certB64), X509SubjectName: v(dn(cert.subject)), X509IssuerSerial: issuerSerial }] }],
        SignatureValue: v(signature),
        SignedInfo: [
          {
            SignatureMethod: v('', { Algorithm: RSA_SHA256 }),
            Reference: [
              {
                Type: 'http://uri.etsi.org/01903/v1.3.2#SignedProperties',
                URI: '#id-xades-signed-props',
                DigestMethod: v('', { Algorithm: SHA256 }),
                DigestValue: v(propsDigest),
              },
              { Type: '', URI: '', DigestMethod: v('', { Algorithm: SHA256 }), DigestValue: v(docDigest) },
            ],
          },
        ],
      };
      const signed = {
        ...inv,
        UBLExtensions: [
          {
            UBLExtension: [
              {
                ExtensionURI: v(XADES),
                ExtensionContent: [
                  {
                    UBLDocumentSignatures: [
                      {
                        SignatureInformation: [
                          { ID: v('urn:oasis:names:specification:ubl:signature:1'), ReferencedSignatureID: v(SIG_INVOICE), Signature: [dsSignature] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        Signature: [{ ID: v(SIG_INVOICE), SignatureMethod: v(XADES) }],
      };
      return { ...ubl, Invoice: [signed] };
    },
  };
}
