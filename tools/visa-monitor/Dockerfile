FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY calendar-probe.js monitor.cjs test.cjs monitor.test.cjs ./
RUN npm test && mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser
ENV NODE_ENV=production DATA_DIR=/data MONITOR_ENABLED=false
CMD ["node", "monitor.cjs"]
