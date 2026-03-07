// src/pages/TermsOfService.tsx
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

export default function TermsOfService() {
  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-500">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">

          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
            <strong>Important:</strong> JollofSwap is a non-custodial decentralized exchange. We do
            not hold your funds, execute trades on your behalf, or provide financial advice.
            Cryptocurrency trading involves significant financial risk. Please read these terms
            carefully before using the Platform.
          </div>

          <H2>1. Acceptance of Terms</H2>
          <P>
            By accessing or using the JollofSwap platform, website, smart contracts, or any related
            services (collectively, the "Platform"), you agree to be bound by these Terms of Service
            ("Terms") and our Privacy Policy, which is incorporated by reference. If you do not agree
            to these Terms, do not use the Platform.
          </P>
          <P>
            These Terms constitute a legally binding agreement between you and JollofSwap ("we",
            "us", or "our"). We reserve the right to update these Terms at any time. Continued use
            after changes constitutes acceptance of the revised Terms.
          </P>

          <H2>2. Description of the Platform</H2>
          <P>
            JollofSwap is a decentralized exchange (DEX) protocol deployed on the Alkebuleum
            blockchain network. The Platform allows users to:
          </P>
          <UL>
            <li>Swap tokens deployed on the Alkebuleum network.</li>
            <li>Provide and remove liquidity from token pools.</li>
            <li>Bridge USDC from Polygon to MAH on Alkebuleum via the JollofSwap Bridge.</li>
            <li>Create and register new tokens via the Token Factory.</li>
            <li>Purchase USDC via a third-party fiat on-ramp (Coinbase Pay) and transfer it to your connected wallet on Polygon.</li>
          </UL>
          <P>
            The Platform interacts with publicly deployed smart contracts. All transactions are
            executed on-chain and are final and irreversible once confirmed. JollofSwap does not
            operate as a broker, dealer, financial institution, or custodian. We do not hold or
            control your digital assets at any time.
          </P>

          <H2>3. Eligibility</H2>
          <H3>3.1 Age Requirement</H3>
          <P>
            You must be at least 18 years of age (or the age of legal majority in your jurisdiction,
            if higher) to use the Platform. By using JollofSwap, you represent and warrant that you
            meet this requirement.
          </P>

          <H3>3.2 Jurisdiction Restrictions</H3>
          <P>
            You may not use the Platform if you are located in, incorporated in, or a resident of
            any jurisdiction where the use of a decentralized exchange or the purchase or sale of
            cryptocurrency is prohibited or restricted by applicable law, including but not limited to
            countries and territories subject to comprehensive sanctions by OFAC, the UN Security
            Council, the EU, or equivalent authorities.
          </P>
          <P>
            By using the Platform, you represent and warrant that your use does not violate any
            applicable law or regulation in your jurisdiction. It is your sole responsibility to
            determine the legality of your use of the Platform in your location.
          </P>

          <H3>3.3 Self-Custody Responsibility</H3>
          <P>
            You must have a compatible self-custodial wallet (such as amVault) to use the Platform.
            You are solely responsible for the security of your wallet, private keys, seed phrase, and
            all transactions initiated from your wallet address. JollofSwap has no ability to recover
            lost funds, reverse transactions, or access your wallet.
          </P>

          <H2>4. Non-Custodial Nature and No Fiduciary Duty</H2>
          <P>
            JollofSwap is a non-custodial protocol. At no point do we take possession of, control, or
            custody over your digital assets. When you interact with JollofSwap smart contracts, you
            are interacting directly with on-chain code. We do not act as your agent, broker,
            financial adviser, or fiduciary. Nothing on the Platform constitutes financial, investment,
            legal, or tax advice.
          </P>

          <H2>5. Third-Party Services</H2>
          <H3>5.1 Coinbase Pay Fiat On-Ramp</H3>
          <P>
            The Platform integrates Coinbase Pay, a third-party fiat-to-crypto payment service, to
            allow users to purchase USDC on Polygon with fiat currency. When you use this service:
          </P>
          <UL>
            <li>
              You are subject to Coinbase's own Terms of Service and Privacy Policy, which you must
              accept independently.
            </li>
            <li>
              Coinbase performs its own identity verification (KYC/AML) and compliance checks.
              JollofSwap does not perform or control this process.
            </li>
            <li>
              All fiat payments, transaction fees charged by Coinbase, and delivery of cryptocurrency
              are the sole responsibility of Coinbase. JollofSwap is not liable for any failure,
              delay, error, or loss arising from your use of Coinbase Pay.
            </li>
            <li>
              By initiating a Coinbase Pay session, you consent to USDC being delivered to your
              connected wallet address on the Polygon network.
            </li>
          </UL>

          <H3>5.2 amVault Wallet</H3>
          <P>
            amVault is an independent self-custodial wallet service used to connect to JollofSwap.
            Your relationship with amVault is governed by amVault's own terms and privacy policy.
            JollofSwap is not responsible for amVault's availability, functionality, or security.
          </P>

          <H3>5.3 Alkebuleum Network and Polygon</H3>
          <P>
            The Platform operates on the Alkebuleum blockchain and, for bridge functionality, on the
            Polygon network. These are independent public networks. JollofSwap has no control over
            their uptime, finality, gas costs, or network upgrades. Use of these networks is at
            your own risk.
          </P>

          <H2>6. Fees</H2>
          <P>
            JollofSwap charges fees for certain services. Fee details are always displayed in the
            user interface before you confirm a transaction. Fees are non-refundable once a
            transaction is submitted to the blockchain.
          </P>
          <UL>
            <li>
              <strong>Bridge fee:</strong> A fee is charged on USDC→MAH bridge deposits. The fee is
              0.10% of the deposit amount, with a minimum of $0.10 and a maximum of $2.00 USD.
              The exact fee for your deposit is shown on the Bridge screen before you proceed.
            </li>
            <li>
              <strong>Swap fee:</strong> A 0.30% liquidity provider fee is charged on all token
              swaps. This fee goes entirely to liquidity providers.
            </li>
            <li>
              <strong>Gas fees:</strong> You are responsible for all network gas fees charged by
              the Alkebuleum and Polygon blockchains. The Platform may automatically arrange a
              small gas top-up on your behalf if your balance is insufficient to cover a
              transaction; any such top-up is disclosed in the amVault signing flow.
            </li>
          </UL>

          <H2>7. Risks</H2>
          <P>
            You acknowledge and accept the following risks inherent to decentralised finance:
          </P>
          <UL>
            <li>
              <strong>Smart contract risk:</strong> Smart contracts may contain bugs or
              vulnerabilities that could result in the partial or total loss of funds. Although our
              contracts are developed with care, no audit provides an absolute guarantee of security.
            </li>
            <li>
              <strong>Market risk:</strong> Cryptocurrency values are highly volatile. The value of
              tokens you hold, swap, or receive may decrease significantly or become worthless.
            </li>
            <li>
              <strong>Liquidity risk:</strong> Liquidity pools may have insufficient depth, resulting
              in high price impact or inability to complete a swap.
            </li>
            <li>
              <strong>Bridge risk:</strong> Cross-chain bridge operations carry additional smart
              contract, network, and operational risks. Bridge transactions are irreversible once
              initiated.
            </li>
            <li>
              <strong>Irreversibility:</strong> All blockchain transactions are final. We cannot
              reverse, cancel, or refund any completed transaction.
            </li>
            <li>
              <strong>Regulatory risk:</strong> The regulatory status of cryptocurrency and DeFi is
              evolving. Changes in laws or regulations may adversely affect the Platform or your
              ability to use it.
            </li>
            <li>
              <strong>Key loss risk:</strong> If you lose access to your wallet or private key,
              your funds are permanently inaccessible. JollofSwap has no recovery mechanism.
            </li>
          </UL>

          <H2>8. Prohibited Activities</H2>
          <P>You agree not to use the Platform to:</P>
          <UL>
            <li>Violate any applicable law, regulation, or third-party rights.</li>
            <li>Engage in money laundering, terrorism financing, or other financial crimes.</li>
            <li>
              Circumvent, disable, or interfere with security features or access controls of the
              Platform or any underlying smart contract.
            </li>
            <li>
              Use automated bots, scripts, or tools to exploit, manipulate, or extract unfair value
              from the Platform or its liquidity pools.
            </li>
            <li>
              Submit fraudulent, misleading, or malicious transactions to the smart contracts.
            </li>
            <li>
              Attempt to register tokens or content that is deceptive, fraudulent, or designed to
              harm other users (e.g., honeypot tokens).
            </li>
            <li>Access the Platform from a jurisdiction where doing so is prohibited.</li>
          </UL>

          <H2>9. Disclaimers and No Warranties</H2>
          <P>
            THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
            EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, JOLLOFSWAP
            DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND UNINTERRUPTED OR ERROR-FREE
            OPERATION.
          </P>
          <P>
            We do not warrant that the Platform will be available at all times, that smart contracts
            will execute as expected, that token prices or exchange rates will be favourable, or that
            bridge operations will complete within any specified time.
          </P>

          <H2>10. Limitation of Liability</H2>
          <P>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, JOLLOFSWAP AND ITS OPERATORS,
            CONTRIBUTORS, AFFILIATES, AND SERVICE PROVIDERS SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF FUNDS, LOSS
            OF PROFITS, LOSS OF DATA, OR ANY OTHER LOSSES ARISING FROM:
          </P>
          <UL>
            <li>Your use of or inability to use the Platform.</li>
            <li>Smart contract bugs, exploits, or failures.</li>
            <li>Third-party service failures (Coinbase Pay, amVault, blockchain networks).</li>
            <li>Unauthorised access to your wallet or private keys.</li>
            <li>Market volatility or loss of token value.</li>
            <li>Any error, omission, or inaccuracy in the Platform's interface or data.</li>
          </UL>
          <P>
            In jurisdictions where some limitation of liability is not permitted, our liability is
            limited to the maximum extent permitted by law.
          </P>

          <H2>11. Indemnification</H2>
          <P>
            You agree to indemnify, defend, and hold harmless JollofSwap and its operators,
            contributors, and service providers from and against any claims, liabilities, damages,
            losses, and expenses (including reasonable legal fees) arising out of or in connection
            with your use of the Platform, your violation of these Terms, or your violation of any
            applicable law or third-party rights.
          </P>

          <H2>12. Intellectual Property</H2>
          <P>
            The JollofSwap brand, logo, interface design, and associated software are the intellectual
            property of JollofSwap and its contributors. You may not reproduce, distribute, modify,
            or create derivative works without express written permission.
          </P>
          <P>
            The underlying smart contracts may be open-source and subject to their respective
            licences. Nothing in these Terms grants you any licence to the JollofSwap brand or
            proprietary frontend code.
          </P>

          <H2>13. Termination and Access Restriction</H2>
          <P>
            We reserve the right to suspend or restrict your access to the Platform at any time, for
            any reason, including but not limited to suspected violation of these Terms, legal
            compliance obligations, or security concerns. Because the underlying smart contracts are
            deployed on public blockchains, we cannot prevent you from interacting with them directly,
            but we may restrict access through our frontend interface.
          </P>

          <H2>14. Governing Law and Dispute Resolution</H2>
          <P>
            These Terms are governed by applicable international law, with particular reference to
            the laws of the jurisdiction in which JollofSwap is incorporated or primarily operated.
            Any dispute arising from these Terms or your use of the Platform shall first be attempted
            to be resolved through good-faith negotiation. If unresolved, disputes shall be submitted
            to binding arbitration in a mutually agreed neutral jurisdiction, to the extent permitted
            by applicable law.
          </P>

          <H2>15. Severability</H2>
          <P>
            If any provision of these Terms is found to be unlawful, void, or unenforceable, that
            provision shall be deemed severable from these Terms and shall not affect the validity
            and enforceability of the remaining provisions.
          </P>

          <H2>16. Entire Agreement</H2>
          <P>
            These Terms, together with our Privacy Policy, constitute the entire agreement between
            you and JollofSwap regarding your use of the Platform and supersede all prior agreements,
            understandings, and representations.
          </P>

          <H2>17. Contact Us</H2>
          <P>
            If you have questions about these Terms, please contact us at:
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
