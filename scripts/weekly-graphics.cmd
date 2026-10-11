@echo off
rem Sunday-evening run of the "This week near you" Instagram graphics (scripts/weekly-graphics.mjs),
rem scheduled by Task Scheduler as "futuregame-weekly-graphics". Renders the coming Monday-Sunday for
rem every region into weekly-graphics\<monday>\<region>\ and appends to weekly-graphics\run.log.
rem Needs the pm2 scheduler on :3001 (it reads the schedule over the local API).
cd /d D:\projects\scheduler
if not exist weekly-graphics mkdir weekly-graphics
echo ==== %DATE% %TIME% ==== >> weekly-graphics\run.log
node scripts\weekly-graphics.mjs >> weekly-graphics\run.log 2>&1
