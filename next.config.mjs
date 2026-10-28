/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "microphone=(self)" }] }];
  },
};
export default nextConfig;
