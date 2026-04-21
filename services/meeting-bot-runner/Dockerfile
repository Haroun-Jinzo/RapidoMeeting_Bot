FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Install PulseAudio and FFmpeg
RUN apt-get update && apt-get install -y \
    pulseaudio \
    ffmpeg \
    alsa-utils \
    && rm -rf /var/lib/apt/lists/*

# Create user group and user for PulseAudio (must run as non-root ideally, or configure pulse for root)
RUN useradd -ms /bin/bash pulseuser
RUN usermod -aG audio,video pulseuser

WORKDIR /app

# Configure PulseAudio for root if running as root
# Or simply enable system-wide mode / allow root
RUN usermod -aG pulse-access root || true

RUN echo "load-module module-null-sink sink_name=MeetingAudio" >> /etc/pulse/system.pa && \
    echo "load-module module-native-protocol-unix auth-anonymous=1" >> /etc/pulse/system.pa && \
    sed -i 's/; autospawn = yes/autospawn = yes/g' /etc/pulse/client.conf && \
    echo "default-server = unix:/var/run/pulse/native" >> /etc/pulse/client.conf

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Playwright browsers are already installed in the base image, 
# but if needed: RUN npx playwright install

# Expose API PORT
EXPOSE 3001

ENV PULSE_SERVER=unix:/var/run/pulse/native
ENV HOST=0.0.0.0
ENV PORT=3001
ENV RECORDINGS_DIR=/tmp/recordings

# Entrypoint script to start pulse audio daemon before node app
RUN echo '#!/bin/bash\n\
rm -rf /var/run/pulse /var/lib/pulse /root/.config/pulse\n\
# Start pulseaudio daemon\n\
pulseaudio -D --exit-idle-time=-1 --system --disallow-exit\n\
# Start the application\n\
npm start\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# If pulseaudio fails in root, use --system
CMD ["/app/entrypoint.sh"]
