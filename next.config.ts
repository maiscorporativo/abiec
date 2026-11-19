import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    // Hostinger limita processos/threads no build (os error 11 ao coletar
    // dados das páginas). Um único worker evita estourar esse limite.
    cpus: 1,
    workerThreads: false,
    serverActions: {
      // uploads de PDFs de template e documentos de passageiros (até 15 MB
      // por arquivo + overhead do multipart)
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
