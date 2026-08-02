/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	serverExternalPackages: ['pdf-parse', 'word-extractor', 'mammoth'],
	experimental: {
		webpackMemoryOptimizations: true
	}
};

export default nextConfig;
