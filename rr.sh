# sudo docker stop $(docker ps -q --filter ancestor=multiconnection_app_nodeapp)

git pull origin main

# git fetch --all
# git reset --hard origin/main

sudo docker compose -v down --remove-orphans
sudo docker compose up --build -d
# sleep 10
# sudo docker run -it -p 3003:3003 multiconnection_app_nodeapp

sudo docker compose logs -f nodeapp
