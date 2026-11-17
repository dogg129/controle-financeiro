# syntax=docker/dockerfile:1

# ============ Estágio 1: instalação das dependências ============
FROM node:20-alpine AS deps
WORKDIR /build
# Copiar só os arquivos de dependências primeiro: a camada fica em cache
# enquanto package.json / package-lock.json não mudarem.
COPY package.json package-lock.json ./
# "npm ci" instala exatamente o que está no lock; --omit=dev ignora ferramentas de desenvolvimento.
RUN npm ci --omit=dev

# ============ Estágio 2: imagem final (runtime) ============
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=8000
WORKDIR /app

# Só o resultado do estágio anterior (node_modules) vai para a imagem final.
COPY --from=deps --chown=node:node /build/node_modules ./node_modules
# O código vem por último: é o que mais muda, então não invalida as camadas acima.
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public

# Segurança: a imagem oficial já traz o usuário "node" (sem privilégios). O processo NÃO roda como root.
USER node

# Documentação: a aplicação escuta na porta 8000 (a publicação é feita no compose).
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Forma "exec" (lista JSON): o Node recebe SIGTERM direto e encerra corretamente.
CMD ["node", "server.js"]
