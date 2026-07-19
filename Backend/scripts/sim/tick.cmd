@echo off
REM Ward-simulator hourly tick — advances the sim one hour and logs.
REM Run by the "SphereWardSim" scheduled task. Backend must be listening on :5050.
cd /d D:\Spherehealth\Backend
echo ==== tick %DATE% %TIME% ==== >> scripts\sim\sim_tick.log
node scripts\sim\wardSimulator.js >> scripts\sim\sim_tick.log 2>&1
