// src/pages/PrivacyPolicy.tsx
import React from 'react'

const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string) ?? 'info@alkebuleum.org'
const EFFECTIVE_DATE = 'March 7, 2026'

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-bold text-slate-900 dark:text-slate-100">{children}</h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 text-base font-semibold text-slate-800 dark:text-slate-200">{children}</h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{children}</p>
  )
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
      {children}
    </ul>
  )
}

export default function PrivacyPolicy() {
  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-500">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">

          <P>
            JollofSwap ("we", "us", or "our") operates the JollofSwap decentralized exchange
            platform accessible at this website (the "Platform"). This Privacy Policy explains how we
            collect, use, disclose, and protect information about you when you use our Platform.
            By accessing or using JollofSwap, you agree to the terms of this Privacy Policy.
          </P>

          <H2>1. Who We Are</H2>
          <P>
            JollofSwap is a decentralized exchange (DEX) built on the Alkebuleum blockchain network.
            We operate a non-custodial protocol, meaning we do not hold, control, or have access to
            your digital assets at any time. Users connect their own self-custodial wallets via
            amVault to interact with on-chain smart contracts directly.
          </P>

          <H2>2. Information We Collect</H2>

          <H3>2.1 Information You Provide</H3>
          <UL>
            <li>
              <strong>Wallet address:</strong> Your public blockchain wallet address when you connect
              via amVault. This is a public identifier on the blockchain.
            </li>
            <li>
              <strong>Account Identifier (AIN):</strong> The unique account identifier associated with
              your amVault session.
            </li>
            <li>
              <strong>Email address (optional):</strong> If you choose to register or sign in through
              our Firebase authentication system for features like the waitlist.
            </li>
          </UL>

          <H3>2.2 Information Collected Automatically</H3>
          <UL>
            <li>
              <strong>Usage data:</strong> Pages visited, features used, buttons clicked, and
              navigation patterns within the Platform.
            </li>
            <li>
              <strong>Device and browser information:</strong> Browser type, operating system,
              screen resolution, and language settings.
            </li>
            <li>
              <strong>IP address:</strong> Your internet protocol address, which may indicate your
              approximate geographic region.
            </li>
            <li>
              <strong>Session data:</strong> Time and duration of visits, referral sources, and
              interaction logs.
            </li>
          </UL>

          <H3>2.3 Blockchain Data</H3>
          <P>
            All transactions executed through JollofSwap smart contracts are recorded permanently on
            the Alkebuleum and Polygon blockchains. This data — including wallet addresses, token
            amounts, transaction hashes, and timestamps — is public by nature and not within our
            control to modify or delete.
          </P>

          <H3>2.4 Information from Third-Party Services</H3>
          <UL>
            <li>
              <strong>Coinbase Pay:</strong> If you use the Coinbase Pay on-ramp feature to purchase
              USDC, Coinbase collects and processes your payment and identity information independently
              under their own privacy policy. We pass only your wallet address and requested currency
              to initiate the session; all payment processing and KYC/AML checks are handled by
              Coinbase. Coinbase's privacy policy is available at{' '}
              <a
                href="https://www.coinbase.com/legal/privacy"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline text-slate-900 dark:text-slate-100"
              >
                coinbase.com/legal/privacy
              </a>.
            </li>
            <li>
              <strong>Firebase (Google):</strong> We use Firebase (Firestore) for storing on-chain
              AMM event logs (swaps, liquidity additions/removals, price history) and for session
              management. Firebase may collect usage data subject to Google's Privacy Policy.
            </li>
            <li>
              <strong>amVault:</strong> amVault is a self-custodial wallet service used to sign and
              broadcast transactions. Your interaction with amVault is governed by amVault's own
              privacy policy and terms.
            </li>
          </UL>

          <H2>3. How We Use Your Information</H2>
          <P>We use the information collected to:</P>
          <UL>
            <li>Provide, operate, and maintain the JollofSwap Platform and its features.</li>
            <li>Process bridge transactions and route crypto to your correct wallet address.</li>
            <li>Detect, prevent, and investigate fraud, abuse, and security incidents.</li>
            <li>Monitor and improve the performance and user experience of the Platform.</li>
            <li>Comply with applicable legal obligations and regulatory requirements.</li>
            <li>Communicate important updates, security notices, or changes to our terms.</li>
          </UL>
          <P>
            We do not sell, rent, or trade your personal information to third parties for marketing
            purposes.
          </P>

          <H2>4. Disclosure of Your Information</H2>
          <P>We may share your information in the following circumstances:</P>
          <UL>
            <li>
              <strong>Service providers:</strong> Third-party vendors who assist in operating the
              Platform (e.g., Firebase, Coinbase, amVault) strictly as needed to deliver the service.
            </li>
            <li>
              <strong>Legal compliance:</strong> If required by law, court order, or government
              authority, or to protect the rights, property, or safety of JollofSwap, our users,
              or the public.
            </li>
            <li>
              <strong>Business transfers:</strong> In connection with a merger, acquisition,
              restructuring, or sale of assets, where your information may be transferred as part
              of that transaction.
            </li>
            <li>
              <strong>With your consent:</strong> For any other purpose with your explicit
              permission.
            </li>
          </UL>

          <H2>5. Blockchain Transparency Notice</H2>
          <P>
            Decentralized exchanges operate on public blockchains. Any transaction you submit through
            JollofSwap — including swaps, liquidity deposits, bridge transfers, and token approvals —
            is permanently recorded on-chain and visible to anyone who queries the blockchain. Your
            wallet address, transaction amounts, and token interactions are inherently public. We have
            no ability to delete or alter on-chain records.
          </P>

          <H2>6. Data Retention</H2>
          <P>
            We retain personal data only for as long as necessary to fulfil the purposes described in
            this Policy, or as required by applicable law. Account and session data is typically
            retained for 12 months after your last activity, unless a longer retention period is
            required for legal compliance. Blockchain transaction data is retained permanently by the
            nature of public distributed ledgers.
          </P>

          <H2>7. Cookies and Tracking Technologies</H2>
          <P>
            We use browser local storage and session storage to remember your preferences (such as
            theme and wallet session). We do not use advertising cookies or third-party tracking
            pixels. Firebase may use cookies for authentication session management.
          </P>

          <H2>8. Your Rights</H2>
          <P>
            Depending on your location, you may have rights under applicable data protection law,
            including:
          </P>
          <UL>
            <li>The right to access personal data we hold about you.</li>
            <li>The right to request correction of inaccurate data.</li>
            <li>
              The right to request deletion of your data (where technically feasible — note that
              on-chain data cannot be deleted).
            </li>
            <li>The right to object to or restrict certain processing.</li>
            <li>The right to data portability.</li>
          </UL>
          <P>
            To exercise any of these rights, please contact us at{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium underline text-slate-900 dark:text-slate-100"
            >
              {SUPPORT_EMAIL}
            </a>
            . We will respond within 30 days.
          </P>

          <H2>9. Security</H2>
          <P>
            We implement reasonable technical and organisational measures to protect your information
            against unauthorised access, loss, or misuse. However, no internet transmission or
            electronic storage system is completely secure. You are responsible for maintaining the
            security of your own wallet private keys and seed phrases. JollofSwap will never ask for
            your private key or seed phrase.
          </P>

          <H2>10. Children's Privacy</H2>
          <P>
            The Platform is not directed to individuals under the age of 18. We do not knowingly
            collect personal data from children. If you believe a child has provided us personal
            information, please contact us and we will delete it promptly.
          </P>

          <H2>11. International Users</H2>
          <P>
            JollofSwap is operated from and primarily serves users in Africa and other regions. If you
            access the Platform from outside these regions, your information may be transferred to and
            processed in jurisdictions with different data protection laws than your own. By using the
            Platform, you consent to such transfer.
          </P>

          <H2>12. Changes to This Policy</H2>
          <P>
            We may update this Privacy Policy from time to time. When we do, we will revise the
            "Effective date" at the top of this page. Continued use of the Platform after any changes
            constitutes your acceptance of the updated Policy. We encourage you to review this page
            periodically.
          </P>

          <H2>13. Contact Us</H2>
          <P>
            If you have questions, concerns, or requests regarding this Privacy Policy or our data
            practices, please contact us at:
          </P>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
            <div className="font-semibold">JollofSwap</div>
            <div className="mt-1">
              Email:{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium underline text-slate-900 dark:text-slate-100"
              >
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
