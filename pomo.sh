#!/bin/bash

# Set script name and full path early.
POMO_SH=$(basename "$0")
POMO_PATH=$(dirname "$0")
POMO_FULL_SH="$0"
export POMO_SH POMO_FULL_SH

POMO_HOME="$HOME/.pomosh"
POMO_LOG=$POMO_HOME'/pomos'
POMO_CONFIG=$POMO_HOME"/pomosh.config"
POMO_ICON=$POMO_PATH"/icon/pomodoro.png"

# ARGUMENTS
#---------------------
cal=$1
eventname=$2

# SOME USEFUL VARIABLES
#----------------------
time=$(date "+%H:%M")
day=$(date "+%Y%m%d")i
# today log file name
#POMO_LOG_FILE="$POMO_LOG/pomodoro_$day.log"
# read variable from config file

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
         		if enabled specify the calendar name to submit the new event.
            -h
                print this help.
	EndHelp
    exit 0
}

# COUNTDOWN TIMER FUNCTION
#------------------------

timer()
{
	let tot_minutes=$1
	sec=0
	for (( i=$tot_minutes; i>=0; i--)); do
		minutes=`echo $i | sed s/^[0-9]$/0\&/`
		bar=$(draw_bar $i $tot_minutes)
		for (( j=$sec; j>=0; j--)); 
		do
			sleep 1 &
			wait
			seconds=`echo $j | sed s/^[0-9]$/0\&/`
			printf "$minutes:$seconds $bar \r"
		done
		sec=59
		bar=''
	done
}

draw_bar()
{
	for (( i=0; i<$1+1;i++)); do
    	bar=$bar"="
    done
	for (( j=0; j<$2-$1; j++)); do
	  	spaces=$spaces'-'
	done
	echo '|'$bar$spaces'|'
}

# PROCESS OPTION
#-------------------------------------------------
while getopts "hlL:d:g:" Option
  do
    case $Option in
    'l')
		[ -f "$POMO_LOG_FILE" ] && cat "$POMO_LOG_FILE" || echo "No pomos today"
		exit 0
		;;
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
	'd')
		if [ -f "$OPTARG" ] 
			then
				POMO_CONFIG=$OPTARG 
			else
				echo echo "specified configuration file  doesn't exists"
				exit 1
			fi
		;;
	'g')
		if [ -d "$OPTARG" ]
			then 
				POMO_LOG=$OPTARG
			else
				echo "specified log directory doesn't exists"
				exit 1
			fi
		;;
	'h')
		help
		exit 1
		;;
    esac
  done


source $POMO_CONFIG
POMO_LOG_FILE="$POMO_LOG/pomodoro_$day.log"

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
echo -e "$today_pomos) \t $time \t $2" >> $POMO_LOG_FILE

# if enabled create new google calendar event
if [ "$calendar_enabled" = "true" ]
then
  echo "calendar"
  calendar="$eventname today at $time for 25 minutes"
  google calendar add --cal "$cal" "$calendar"
fi

# every 4 pomodoro one long break
[ $(( $today_pomos % 4 )) -eq 0 ] && break_min=$long_break_min || break_min=$short_break_min

# if enabled shows growl pomodoro end notification
[ "$growl_enabled" = "true" ] && growlnotify --image $POMO_ICON -s -n $POMO_SH -m "$eventname pomodoro finished. Take a $break_min minutes break"

# take a long or short break
echo "Start $break_min minutes break or skip? ['b','s']"
read reply
if [ $reply = 'b' ]
then
  timer $break_min
  # if enabled shows break end notification
  [ "$growl_enabled" = "true" ] && growlnotify --image $POMO_ICON -s -n $POMO_SH -m "break finished. Back to work"
fi

exit 1

