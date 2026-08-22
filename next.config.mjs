/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The /prototype folder is the design reference, not part of the build.
  eslint: { ignoreDuringBuilds: true },
  // sharp es un módulo nativo: empaquetarlo rompe sus binarios. Se usa en el servidor para encoger
  // los stickers que exceden el límite de la API oficial (ver src/lib/cloud-outbox.ts).
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
