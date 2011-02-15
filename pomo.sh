#!/bin/bash

# Set script name and full path early.
POMO_SH=$(basename "$0")
POMO_PATH=$(dirname "$0")
POMO_FULL_SH="$0"
export POMO_SH POMO_FULL_SH
POMO_ICON=$POMO_PATH"/icon/pomodoro.jpg"

POMO_HOME="$HOME/.pomosh"
POMO_LOG="$POMO_HOME/pomos"
POMO_CONFIG=$POMO_HOME"/pomosh.cfg"

# DEFAULT TIME CONFIGURATION
#----------------------
pomodoro_min=25
short_break_min=5
long_break_min=15

# EXTENSIONS
#-----------
calendar_enabled="false"
growl_enabled="false"

time=$(date "+%H:%M")
day=$(date "+%Y%m%d")

online_usage="$POMO_SH [-lh] [-L DATE] [-d CONFIG_FILE] [-c calendar] 
			  -g [LOG_DIRECTORY] [pomodoro_name]"

usage()
{
  cat <<-EndUsage
  Usage: $online_usage
  Try "$POMO_SH -h" for more information.
EndUsage
  exit 1
}

# HELP
# ----
help()
{
    cat <<-EndHelp
      Usage: $online_usage

      Example: $POMO_SH "write exhaustive help guide"

      Options:
          -l
            list today pomos.
          -L DATE
            list DATE pomos. DATE must be in YYYYMMDD format.
          -d CONFIG_FILE
            use CONFIG_FILE file other than default ~/.pomosh/pomosh.config
          -g LOG_DIRECTORY
            use LOG_DIRECTORY other than default ~/.pomosh/log/             
          -c calendar
            if enabled specify the calendar name.
          -h
            print this help.
      
      Configuration:       
          POMO_HOME               the Pomosh home directory.
          POMO_LOG                the logs directory.
          POMO_CONFIG=CONFIG_FILE same as option -d CONFIG_FILE.
            
          pomodoro_min            pomodoro duration in minutes (default 25).
          short_break_min         short break duration in minutes (default 5).
          long_break_min          long break duration in minutes (default 15).
            
          calendar_enabled        enable Google calendar synchronization. (default='false')
          growl_enabled           enable Growl notifycations. (default='false')

EndHelp
    exit 0
}

# COUNTDOWN TIMER FUNCTION
#------------------------

timer()
{
  min=$1
  bar=$(draw_bar $1 $1)
  while [ $min -gt 0 ]; do
    for (( sec=60; sec>0; sec--)); do
      [ $sec == 59 ] && {
        let min=$min-1
        bar=$(draw_bar $min $1)
      }
      [ $sec == 60 ] && print_sec='00' || print_sec=`echo $sec | sed s/^[0-9]$/0\&/`
      print_min=`echo $min | sed s/^[0-9]$/0\&/`
      printf "$print_min:$print_sec $bar \r"
      sleep 1 &
      wait
    done
  done
}

draw_bar()
{
  for (( i=0;i<$2+1;i++)); do
    [ $i -le $1 ] && b=$b"="|| b=$b"-"
  done
  echo '|'$b'|'
}


# MAIN
#-----

# read config file
source $POMO_CONFIG

if [ ! -f "$POMO_CONFIG" ]
then
  echo "Fatal Error: Cannot read configuration file $POMO_CONFIG"
  exit 1;
fi

if [ ! -d $POMO_LOG ]
then
  echo echo "Fatal Error: Cannot write in log directory $POMO_LOG"
  exit 1;
fi

POMO_LOG_FILE="$POMO_LOG/pomodoro_$day.log"

# PROCESS OPTION
#-------------------------------------------------
while getopts "hlL:d:g:c:" Option
  do
    case $Option in
    # list today
    'l')
      echo $POMO_LOG_FILE
		  [ -f "$POMO_LOG_FILE" ] && cat "$POMO_LOG_FILE" || echo "No pomos today"
		  exit 0
		  ;;
    # list date
	  'L')
		  if [ -f "$POMO_LOG/pomodoro_$OPTARG.log" ] 
			then 
			  cat "$POMO_LOG/pomodoro_$OPTARG.log" 
				exit 0
			else
			  echo "No pomos in this date"
				exit 1
			fi
      ;;
    # specific file configuration
    'd')
		  if [ -f "$OPTARG" ] 
			then
				POMO_CONFIG=$OPTARG 
			else
				echo echo "specified configuration file  doesn't exists"
				exit 1
			fi
		  ;;
    # specific log directory
	  'g')
		  if [ -d "$OPTARG" ]
			then 
				POMO_LOG=$OPTARG
			else
				echo "specified log directory doesn't exists"
				exit 1
			fi
		  ;;
    # show help message
	  'h')
		  help
		  exit 0
		  ;;
    #specific Google calendar name
    'c')
      cal=$OPTARG
      ;;
    esac
  done


# ARGUMENTS
#----------
for last; do true; done
eventname=$last

# START POMODORO
#------------------
timer $pomodoro_min 

# WRITE POMODORO REMINDER AFTER EACH POMODORO
if [ -f $POMO_LOG_FILE ]
then
  rows=$(wc -l $POMO_LOG_FILE | awk '{print $1}')
  let today_pomos=$rows+1
else
  today_pomos=1
fi
echo -e "$today_pomos) \t $time \t $eventname" >> $POMO_LOG_FILE

# if enabled create new google calendar event
if [ "$calendar_enabled" = "true" ]
then
  calendar="pomosh: $eventname today at $time for 25 minutes"
  ERORR=$( google calendar add --cal "$cal" "$calendar" 2>&1 )
  # some code to catch error and retry to post event
fi

# every 4 pomodoro one long break
[ $(( $today_pomos % 4 )) -eq 0 ] && break_min=$long_break_min || break_min=$short_break_min

# if enabled shows growl pomodoro end notification
[ $growl_enabled == "true" ] && growlnotify --image $POMO_ICON -s  -m "$eventname pomodoro finished. Take a $break_min minutes break"

# take a long or short break
echo "Start $break_min minutes break or skip? ['b','s']"
read -s -n 1 reply
if [ $reply = 'b' ]
then
  timer $break_min
  # if enabled shows break end notification
  [ $growl_enabled == "true" ] && growlnotify --image $POMO_ICON -s -n $POMO_SH -m "break finished. Back to work"
fi

exit 1

