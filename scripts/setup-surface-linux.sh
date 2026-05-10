#!/bin/bash
# Linux Surface setup for Omarchy (Arch) and Debian/Ubuntu
# Run as normal user (sudo will be prompted as needed)

set -e

KEY_URL="https://raw.githubusercontent.com/linux-surface/linux-surface/master/pkg/keys/surface.asc"
KEY_FP="56C464BAAC421453"

detect_distro() {
  if [[ -f /etc/arch-release ]]; then
    echo "arch"
  elif grep -qEi 'debian|ubuntu' /etc/os-release 2>/dev/null; then
    echo "debian"
  else
    echo "unknown"
  fi
}

DISTRO=$(detect_distro)

if [[ $DISTRO == "unknown" ]]; then
  echo "Error: Unsupported distribution. Only Arch and Debian/Ubuntu are supported."
  exit 1
fi

echo "==> Detected distribution: $DISTRO"

echo "==> Adding linux-surface GPG key..."

case $DISTRO in
  arch)
    curl -s "$KEY_URL" | sudo pacman-key --add -
    sudo pacman-key --finger "$KEY_FP"
    sudo pacman-key --lsign-key "$KEY_FP"
    ;;

  debian)
    wget -qO - "$KEY_URL" | gpg --dearmor | sudo dd of=/etc/apt/trusted.gpg.d/linux-surface.gpg 2>/dev/null
    ;;
esac

echo "==> Adding linux-surface repository..."

case $DISTRO in
  arch)
    if ! grep -q "\[linux-surface\]" /etc/pacman.conf; then
      printf "\n[linux-surface]\nServer = https://pkg.surfacelinux.com/arch/\n" \
        | sudo tee -a /etc/pacman.conf
    fi
    ;;

  debian)
    if [[ ! -f /etc/apt/sources.list.d/linux-surface.list ]]; then
      echo "deb [arch=amd64] https://pkg.surfacelinux.com/debian release main" \
        | sudo tee /etc/apt/sources.list.d/linux-surface.list
    fi
    ;;
esac

echo "==> Syncing package databases..."

case $DISTRO in
  arch)  sudo pacman -Sy ;;
  debian) sudo apt update ;;
esac

echo "==> Installing linux-surface kernel, headers and iptsd..."

case $DISTRO in
  arch)
    sudo pacman -S --needed linux-surface linux-surface-headers iptsd
    ;;

  debian)
    sudo apt install -y linux-image-surface linux-headers-surface iptsd
    ;;
esac

echo "==> Installing libwacom-surface and surface-control..."

case $DISTRO in
  arch)
    echo "==> Removing libwacom (conflicts with libwacom-surface)..."
    sudo pacman -Rdd --noconfirm libwacom 2>/dev/null || true
    yay -S --needed --noconfirm libwacom-surface surface-control
    ;;

  debian)
    # Ubuntu 26.04: skip libwacom-surface due to bug #2076
    if grep -q "UBUNTU_CODENAME=mantic\|VERSION_ID=\"26.04\"" /etc/os-release 2>/dev/null; then
      echo "    Skipping libwacom-surface on Ubuntu 26.04 (known bug #2076)"
    else
      sudo apt install -y libwacom-surface
    fi
    sudo apt install -y surface-control 2>/dev/null || echo "    surface-control not in apt; install from https://github.com/linux-surface/surface-control"
    ;;
esac

if [[ $DISTRO == "arch" ]] && command -v mkinitcpio &>/dev/null; then
  echo "==> Ensuring keyboard works at LUKS prompt..."

  sudo mkdir -p /etc/mkinitcpio.conf.d

  if [[ ! -f /etc/mkinitcpio.conf.d/surface_device_modules.conf ]]; then
    pinctrl_module=$(lsmod | grep pinctrl_ | cut -f 1 -d" ")
    echo "MODULES=(${pinctrl_module} surface_aggregator surface_aggregator_registry surface_aggregator_hub surface_hid_core surface_hid surface_kbd intel_lpss intel_lpss_pci 8250_dw)" \
      | sudo tee /etc/mkinitcpio.conf.d/surface_device_modules.conf >/dev/null
    echo "    Wrote surface modules to /etc/mkinitcpio.conf.d/surface_device_modules.conf"
  else
    echo "    Module config already exists, skipping"
  fi

  if grep -q 'encrypt keyboard' /etc/mkinitcpio.conf; then
    sudo sed -i 's/encrypt keyboard/keyboard encrypt/g' /etc/mkinitcpio.conf
    echo "    Fixed HOOKS order (keyboard before encrypt)"
  else
    echo "    HOOKS order already correct or no encrypt hook found"
  fi

  echo "==> Regenerating initramfs..."
  sudo mkinitcpio -P
fi

echo "==> Starting iptsd (touch/pen daemon)..."
IPTSD_DEVICE=$(sudo iptsd-find-service 2>/dev/null | tail -n1)
if [[ -n $IPTSD_DEVICE ]]; then
  sudo systemctl start "$IPTSD_DEVICE"
  echo "    Started $IPTSD_DEVICE"
else
  echo "    iptsd device not found - will be started automatically by udev on next boot"
fi

echo ""
echo "======================================================"
echo " Setup complete!"
if [[ $DISTRO == "arch" ]]; then
  echo " IMPORTANT: Reboot and select 'linux-surface' in the"
  echo " Limine boot menu to use the Surface kernel."
else
  echo " IMPORTANT: Reboot and select 'linux-surface' in GRUB"
  echo " to use the Surface kernel."
fi
echo "======================================================"
