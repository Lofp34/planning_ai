import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        }
    },
    plugins: [
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'AIgenda.png'],
            manifest: {
                name: 'AIgenda',
                short_name: 'AIgenda',
                description: 'Un planning Kanban intelligent pour organiser vos tâches avec l\'aide de l\'IA.',
                theme_color: '#ffffff',
                icons: [
                    {
                        src: 'AIgenda.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'AIgenda.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        })
    ]
});
