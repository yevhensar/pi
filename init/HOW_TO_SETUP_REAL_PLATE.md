Yes, that's exactly how most people set up a Raspberry Pi 5 for the first time. The easiest method is:

1. Use your Ubuntu PC.
2. Download Raspberry Pi Imager.
3. Insert a microSD card into your Ubuntu machine.
4. Flash Raspberry Pi OS onto the card.
5. Configure Wi-Fi and SSH before flashing.
6. Insert the card into the Raspberry Pi 5 and boot it.

### What You'll Need

* Raspberry Pi 5
* Power supply (27W USB-C recommended)
* MicroSD card (32 GB or larger is ideal)
* Ubuntu desktop/laptop
* Internet connection
* Keyboard and mouse (optional if using SSH)
* HDMI monitor (optional but recommended for the first boot)

---

## Step 1 - Install Raspberry Pi Imager

Open Terminal on Ubuntu and run:

```bash
sudo apt update
sudo apt install rpi-imager
```

If that doesn't work:

```bash
sudo snap install rpi-imager
```

Launch it:

```bash
rpi-imager
```

or find it in your applications menu.

---

## Step 2 - Insert the MicroSD Card

Insert the microSD card into your Ubuntu machine.

Make sure it appears in Ubuntu.

---

## Step 3 - Select the Operating System

Inside Raspberry Pi Imager:

1. Click "Choose Device"
2. Select:

```
Raspberry Pi 5
```

Then:

```
Choose OS
```

For beginners I recommend:

```
Raspberry Pi OS (64-bit)
```

or

```
Raspberry Pi OS (64-bit) with Desktop
```

Do NOT choose Lite if you want a GUI.

---

## Step 4 - Select the Storage Device

Choose your microSD card.

Double check that it is the correct drive.

---

## Step 5 - Configure Settings BEFORE Writing

When you click "Next", Raspberry Pi Imager will ask:

```
Apply OS customization settings?
```

Choose:

```
Edit Settings
```

Fill in the following.

### Hostname

Example:

```
pi5.local
```

or

```
raspberrypi.local
```

---

### Username

Do NOT use the old "pi" user.

Example:

```
yevhen
```

---

### Password

Choose a strong password.

Example:

```
your-secure-password
```

---

### Configure WiFi

Enable:

```
Configure wireless LAN
```

Fill:

```
SSID:
Your WiFi name

Password:
Your WiFi password

Country:
US
```

If you're elsewhere, choose your country.

---

### Enable SSH

Check:

```
Enable SSH
```

Then select:

```
Use password authentication
```

This is easiest for beginners.

---

### Locale Settings

Example:

```
Time Zone:
America/Los_Angeles

Keyboard:
us
```

or whatever layout you use.

---

## Step 6 - Write the Image

Click:

```
Save
```

then:

```
Yes
```

The flashing process may take several minutes.

Wait until it finishes and verifies the image.

---

## Step 7 - Safely Remove the Card

Ubuntu may automatically mount the card after flashing.

Safely eject it before removing.

---

## Step 8 - First Boot

Insert the microSD card into your Raspberry Pi 5.

Connect:

* Power
* HDMI monitor
* Keyboard
* Mouse (optional)

Then power it on.

The first boot may take 1–2 minutes.

---

## Step 9 - Verify WiFi

Open a terminal on the Raspberry Pi and run:

```bash
hostname -I
```

You should see something like:

```text
192.168.1.115
```

---

## Step 10 - SSH from Ubuntu

On your Ubuntu machine:

```bash
ssh yevhen@pi5.local
```

or:

```bash
ssh yevhen@192.168.1.115
```

Accept the SSH key:

```text
yes
```

Enter your password.

You now have remote access.

---

## Step 11 - Update the System

After logging in:

```bash
sudo apt update
sudo apt upgrade -y
```

Reboot:

```bash
sudo reboot
```

---

## Recommended Setup

When using Raspberry Pi 5 for development, I recommend:

```text
Raspberry Pi OS (64-bit)
+ Desktop

Enabled:
- SSH
- WiFi
- Hostname
- User account

Optional:
- VNC
- Bluetooth
```

This gives you:

* Full desktop environment.
* Keyboard and mouse support.
* HDMI support.
* SSH access from Ubuntu.
* Wi-Fi connectivity out of the box.
* Easy remote development.

For a first Raspberry Pi 5, this setup is simple, reliable, and requires almost no Linux administration knowledge.
