#!/bin/bash
set -e

echo "Setting up FindMyVoice backend..."

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Create default config directory
mkdir -p ~/.findmyvoice

echo "Setup complete! Activate with: source venv/bin/activate"
