import React from 'react'

export default function Compliance() {
  return (
    <div className="wrap">
      <div className="card">
        <div className="title">Compliance & Legal Disclosures</div>
        <div className="hr" />
        <ul className="muted" style={{ lineHeight: 1.6 }}>
          <li>
            <strong>Purpose of the Platform.</strong> JollofSwap is a software
            interface that allows users to interact directly with smart contracts
            deployed on the Alkebuleum network. It facilitates access to
            on-chain utility tokens such as <b>AKE</b> (network gas/fee token) and
            <b> RPU</b> (reputation and governance token).
          </li>
          <li>
            <strong>No Financial Intermediation.</strong> JollofSwap is not a
            broker-dealer, money-services business, bank, exchange, or custodian.
            The platform does not hold, transfer, or convert any fiat currency on
            behalf of users. All interactions occur on-chain, under the user’s
            exclusive control.
          </li>
          <li>
            <strong>User Control & Self-Custody.</strong> Access is provided
            through <b>AmVault</b>, a self-custodial wallet. Users retain control
            of their private keys and are responsible for securing their own
            accounts and devices.
          </li>
          <li>
            <strong>Token Classification.</strong> AKE and related tokens are
            intended solely for network operation—such as paying transaction fees,
            staking, governance participation, and validator compensation—and are
            not offered or marketed as investment products or securities. No
            expectation of profit from others’ efforts should be inferred.
          </li>
          <li>
            <strong>Finality of Transactions.</strong> Blockchain transactions are
            irreversible once confirmed. Users should verify all details before
            signing or broadcasting any transaction.
          </li>
          <li>
            <strong>Third-Party Markets.</strong> Any secondary listings,
            swaps, or valuations on independent marketplaces are outside of
            JollofSwap’s control. The platform neither endorses nor facilitates
            off-chain trading or speculative activity.
          </li>
          <li>
            <strong>Future Services.</strong> Planned features such as token swap
            integrations or validator-support purchases will remain non-custodial
            and compliant with applicable virtual-asset regulations. Regional
            restrictions or KYC/AML procedures may apply when required by law.
          </li>
          <li>
            <strong>Disclaimers.</strong> Use of JollofSwap is at your own risk.
            The software is provided “as-is” without warranties of any kind.
            Nothing on this site constitutes financial, investment, or legal
            advice.
          </li>
          <li>
            <strong>Governance & Foundation Oversight.</strong> The Alkebuleum
            Foundation oversees the open-source infrastructure and may publish
            policy updates, transparency reports, and audit results to maintain
            regulatory compliance and public trust.
          </li>
        </ul>
      </div>
    </div>
  )
}
