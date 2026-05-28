FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY index.js ./
COPY lib ./lib
EXPOSE 3006
CMD ["node", "index.js"]
