#!/bin/bash
# surface-setup-arch.sh
# Linux Surface setup for Surface Laptop Studio on Omarchy/Arch
# Run as normal user (sudo will be prompted as needed)

set -e

echo "==> Adding linux-surface GPG key..."
curl -s https://raw.githubusercontent.com/linux-surface/linux-surface/master/pkg/keys/surface.asc \
  | sudo pacman-key --add -
sudo pacman-key --finger 56C464BAAC421453
sudo pacman-key --lsign-key 56C464BAAC421453

echo "==> Adding linux-surface repository..."
if ! grep -q "\[linux-surface\]" /etc/pacman.conf; then
  echo -e "\n[linux-surface]\nServer = https://pkg.surfacelinux.com/arch/" \
    | sudo tee -a /etc/pacman.conf
fi

echo "==> Syncing package databases..."
sudo pacman -Sy

echo "==> Installing linux-surface kernel, headers and iptsd..."
sudo pacman -S --needed linux-surface linux-surface-headers iptsd

echo "==> Starting iptsd (touch/pen daemon)..."
IPTSD_DEVICE=$(sudo iptsd-find-service 2>/dev/null | tail -n1)
if [ -n "$IPTSD_DEVICE" ]; then
  sudo systemctl start "$IPTSD_DEVICE"
  echo "    Started $IPTSD_DEVICE"
else
  echo "    iptsd device not found - will be started automatically by udev on next boot"
fi

echo "==> Removing libwacom (conflicts with libwacom-surface)..."
sudo pacman -Rdd --noconfirm libwacom 2>/dev/null || true

echo "==> Installing libwacom-surface and surface-control from AUR..."
yay -S --needed --noconfirm libwacom-surface surface-control

echo ""
echo "======================================================"
echo " Setup complete!"
echo " IMPORTANT: Reboot and select 'linux-surface' in the"
echo " Limine boot menu to use the Surface kernel."
echo "======================================================"
