set -eu

sudo dnf install -y git jq unzip tar gzip procps-ng cargo nss nspr libxkbcommon atk at-spi2-atk at-spi2-core libXcomposite libXdamage libXrandr libXfixes libXcursor libXi libXtst libXScrnSaver libXext mesa-libgbm libdrm mesa-libGL mesa-libEGL cups-libs alsa-lib pango cairo gtk3 dbus-libs

curl -fsSL https://bun.sh/install -o /tmp/install-bun.sh
bash /tmp/install-bun.sh bun-v1.3.14
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bunx

curl -fsSL https://code-server.dev/install.sh -o /tmp/install-code-server.sh
sudo sh /tmp/install-code-server.sh --method standalone --prefix /usr/local

curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh \
  | sudo env RTK_INSTALL_DIR=/usr/local/bin sh
if ! rtk --version >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sudo sh -s -- -y --profile minimal
  sudo /root/.cargo/bin/cargo install --git https://github.com/rtk-ai/rtk --locked --root /usr/local --force
fi

bun install -g agent-browser
sudo ln -sf "$HOME/.bun/bin/agent-browser" /usr/local/bin/agent-browser
agent-browser install

git --version
bun --version
rtk --version
code-server --version
agent-browser --version
agent-browser open 'data:text/html,<title>Sandbox Ready</title><main>ready</main>'
agent-browser get title
agent-browser close
test ! -e /vercel/sandbox/.git
