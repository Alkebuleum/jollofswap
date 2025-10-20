import React from 'react'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="footer" role="contentinfo">
      <div>© {year} Alkebuleum Technology LLC</div>
      <div>JollofSwap™ • v0.1</div>
    </footer>
  )
}
