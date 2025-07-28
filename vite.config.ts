import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
    // La section 'define' est maintenant inutile
    // car Vite expose automatiquement `import.meta.env`
    // pour les variables préfixées par VITE_
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        }
    }
});
