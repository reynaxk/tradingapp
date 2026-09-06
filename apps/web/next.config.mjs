/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
    // wagmi's connectors barrel (wagmi/connectors) unconditionally re-exports Coinbase's
    // baseAccount/coinbaseWallet connectors alongside the ones this app actually uses (see
    // lib/wagmi-config.ts). Those pull in @coinbase/cdp-sdk's optional x402-payments code
    // path, which statically imports @x402/* packages this app never installs — it doesn't
    // use in-wallet payments — and Next's webpack build otherwise fails trying to resolve
    // them. Never constructing those connectors isn't enough to avoid this: ES module
    // imports are resolved for the whole file graph before tree-shaking removes anything.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};

export default nextConfig;
