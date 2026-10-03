import { api } from './api';
function decode(v: string) {
  return Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
}
function encode(v: ArrayBuffer | null) {
  if (!v) return null;
  return btoa(String.fromCharCode(...new Uint8Array(v)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function serialize(c: PublicKeyCredential) {
  const r = c.response;
  const result: Record<string, unknown> = {
    id: c.id,
    rawId: encode(c.rawId),
    type: c.type,
    authenticatorAttachment: c.authenticatorAttachment,
    clientExtensionResults: c.getClientExtensionResults(),
  };
  if (r instanceof AuthenticatorAttestationResponse)
    result.response = {
      clientDataJSON: encode(r.clientDataJSON),
      attestationObject: encode(r.attestationObject),
      transports: r.getTransports(),
    };
  else {
    const a = r as AuthenticatorAssertionResponse;
    result.response = {
      clientDataJSON: encode(a.clientDataJSON),
      authenticatorData: encode(a.authenticatorData),
      signature: encode(a.signature),
      userHandle: encode(a.userHandle),
    };
  }
  return result;
}
export async function registerPasskey(name: string) {
  const raw = await api<{ publicKey: Record<string, any> }>('/passkeys/begin', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const p = raw.publicKey;
  const options = {
    ...p,
    challenge: decode(p.challenge),
    user: { ...p.user, id: decode(p.user.id) },
    excludeCredentials: p.excludeCredentials?.map((c: any) => ({
      ...c,
      id: decode(c.id),
    })),
  } as unknown as PublicKeyCredentialCreationOptions;
  const c = await navigator.credentials.create({ publicKey: options });
  if (!c) throw new Error('注册已取消');
  await api('/passkeys/finish', {
    method: 'POST',
    body: JSON.stringify(serialize(c as PublicKeyCredential)),
  });
}
export async function loginPasskey(username: string) {
  const raw = await api<{ publicKey: Record<string, any> }>(
    '/auth/passkey/begin',
    { method: 'POST', body: JSON.stringify({ username }) },
  );
  const p = raw.publicKey;
  const options = {
    ...p,
    challenge: decode(p.challenge),
    allowCredentials: p.allowCredentials?.map((c: any) => ({
      ...c,
      id: decode(c.id),
    })),
  } as PublicKeyCredentialRequestOptions;
  const c = await navigator.credentials.get({ publicKey: options });
  if (!c) throw new Error('验证已取消');
  await api('/auth/passkey/finish', {
    method: 'POST',
    body: JSON.stringify(serialize(c as PublicKeyCredential)),
  });
}
