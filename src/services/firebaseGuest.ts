import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from './firebase'

export async function ensureFirebaseGuest() {
    if (auth.currentUser) return auth.currentUser

    const email = import.meta.env.VITE_FB_GUEST_EMAIL as string | undefined
    const password = import.meta.env.VITE_FB_GUEST_PASSWORD as string | undefined
    if (!email || !password) throw new Error('Missing VITE_FB_GUEST_EMAIL / VITE_FB_GUEST_PASSWORD')

    const res = await signInWithEmailAndPassword(auth, email, password)
    return res.user
}
