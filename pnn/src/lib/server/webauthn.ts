import {
	generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
	type AuthenticationResponseJSON, type RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { Cookies } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { addCredential, createSession, createUser, getCredential, saveChallenge, SESSION_MS, setCounter, takeChallenge } from './auth';
import { b64url, fromB64url } from './crypto';
import { Problem } from './posts';

const CHALLENGE_COOKIE = 'pnn_c';
export const SESSION_COOKIE = 'pnn_s';

function cookieOpts(url: URL, maxAgeSec: number) {
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:', maxAge: maxAgeSec };
}

export async function registerOptions(db: D1Database, url: URL, cookies: Cookies, now: number) {
	const pendingUser = crypto.randomUUID();
	const options = await generateRegistrationOptions({
		rpName: 'pnn',
		rpID: url.hostname,
		userName: 'pnn-' + pendingUser.slice(0, 8),
		userDisplayName: 'pnn',
		userID: new TextEncoder().encode(pendingUser),
		attestationType: 'none',
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
	});
	cookies.set(CHALLENGE_COOKIE, await saveChallenge(db, options.challenge, pendingUser, now), cookieOpts(url, 300));
	return options;
}

export async function registerVerify(db: D1Database, url: URL, cookies: Cookies, response: RegistrationResponseJSON, now: number) {
	const c = await takeChallenge(db, cookies.get(CHALLENGE_COOKIE), now);
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	if (!c?.pendingUser) throw new Problem(400, 'challenge expired');
	let v;
	try {
		v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: url.origin, expectedRPID: url.hostname });
	} catch (e) {
		throw new Problem(400, 'verification failed: ' + (e as Error).message);
	}
	if (!v.verified) throw new Problem(400, 'verification failed');
	const cred = v.registrationInfo.credential;
	await createUser(db, c.pendingUser, now);
	await addCredential(db, { id: cred.id, userId: c.pendingUser, publicKey: b64url(cred.publicKey), counter: cred.counter, transports: cred.transports ?? [] }, now);
	cookies.set(SESSION_COOKIE, await createSession(db, c.pendingUser, now), cookieOpts(url, SESSION_MS / 1000));
	return { ok: true };
}

export async function loginOptions(db: D1Database, url: URL, cookies: Cookies, now: number) {
	const options = await generateAuthenticationOptions({ rpID: url.hostname, userVerification: 'preferred' });
	cookies.set(CHALLENGE_COOKIE, await saveChallenge(db, options.challenge, null, now), cookieOpts(url, 300));
	return options;
}

export async function loginVerify(db: D1Database, url: URL, cookies: Cookies, response: AuthenticationResponseJSON, now: number) {
	const c = await takeChallenge(db, cookies.get(CHALLENGE_COOKIE), now);
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	if (!c) throw new Problem(400, 'challenge expired');
	const stored = await getCredential(db, response.id);
	if (!stored) throw new Problem(400, 'unknown passkey');
	let v;
	try {
		v = await verifyAuthenticationResponse({
			response, expectedChallenge: c.challenge, expectedOrigin: url.origin, expectedRPID: url.hostname,
			credential: { id: stored.id, publicKey: fromB64url(stored.publicKey), counter: stored.counter, transports: stored.transports }
		});
	} catch (e) {
		throw new Problem(400, 'verification failed: ' + (e as Error).message);
	}
	if (!v.verified) throw new Problem(400, 'verification failed');
	await setCounter(db, stored.id, v.authenticationInfo.newCounter);
	cookies.set(SESSION_COOKIE, await createSession(db, stored.userId, now), cookieOpts(url, SESSION_MS / 1000));
	return { ok: true };
}
